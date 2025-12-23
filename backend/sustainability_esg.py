"""
Sustainability & ESG Dashboard API
Environmental tracking for energy, water, nutrients, waste, and carbon footprint
Includes ESG scoring algorithm for investor reporting

SCALABLE DESIGN:
- Uses real data from wholesale orders (transport carbon) and nutrient logs when available
- Falls back to estimates or null when farm doesn't track specific metrics
- Optional data sources: energy, water, waste (small farms can skip these)
- Core metrics: transport carbon (from orders) and nutrients (from automation)
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timedelta
from enum import Enum
import random
import httpx
import os

router = APIRouter()

# Configuration
NODE_API_URL = os.getenv("NODE_API_URL", "http://localhost:8091")
ENABLE_REAL_DATA = os.getenv("SUSTAINABILITY_REAL_DATA", "true").lower() == "true"

# ============================================================================
# ENUMS
# ============================================================================

class EnergySource(str, Enum):
    GRID = "grid"
    SOLAR = "solar"
    WIND = "wind"
    HYBRID = "hybrid"

class WasteType(str, Enum):
    ORGANIC = "organic"
    PACKAGING = "packaging"
    GENERAL = "general"
    HAZARDOUS = "hazardous"

# ============================================================================
# MODELS
# ============================================================================

class EnergyUsage(BaseModel):
    timestamp: str
    kwh_used: float
    source_type: EnergySource
    cost_cad: float
    carbon_kg: float  # CO2 equivalent
    
class WaterUsage(BaseModel):
    timestamp: str
    liters_used: float
    recycled_liters: float
    efficiency_percent: float
    cost_cad: float
    
class NutrientUsage(BaseModel):
    timestamp: str
    nutrient_type: str
    volume_ml: float
    waste_ml: float
    efficiency_percent: float
    
class WasteTracking(BaseModel):
    date: str
    waste_type: WasteType
    weight_kg: float
    recycled_kg: float
    composted_kg: float
    landfill_kg: float
    
class CarbonFootprint(BaseModel):
    date: str
    energy_carbon_kg: float
    water_carbon_kg: float
    transport_carbon_kg: float
    total_kg: float

# ============================================================================
# IN-MEMORY STORAGE
# ============================================================================

energy_usage_db: List[EnergyUsage] = []
water_usage_db: List[WaterUsage] = []
nutrient_usage_db: List[NutrientUsage] = []
waste_tracking_db: List[WasteTracking] = []
carbon_footprint_db: List[CarbonFootprint] = []

# ============================================================================
# DEMO DATA GENERATION
# ============================================================================

def generate_demo_data():
    """Generate 90 days of demo sustainability data"""
    global energy_usage_db, water_usage_db, nutrient_usage_db, waste_tracking_db, carbon_footprint_db
    
    energy_usage_db = []
    water_usage_db = []
    nutrient_usage_db = []
    waste_tracking_db = []
    carbon_footprint_db = []
    
    for day in range(90, 0, -1):
        date = (datetime.now() - timedelta(days=day)).date()
        timestamp = datetime.combine(date, datetime.min.time()).isoformat()
        
        # Energy usage (realistic vertical farm consumption)
        kwh_base = random.uniform(280, 320)  # Daily kWh for lighting, HVAC
        solar_percentage = random.uniform(0.15, 0.35)  # 15-35% solar
        grid_kwh = kwh_base * (1 - solar_percentage)
        solar_kwh = kwh_base * solar_percentage
        
        # Grid energy
        energy_usage_db.append(EnergyUsage(
            timestamp=timestamp,
            kwh_used=grid_kwh,
            source_type=EnergySource.GRID,
            cost_cad=round(grid_kwh * 0.12, 2),  # $0.12/kWh Ontario rate
            carbon_kg=round(grid_kwh * 0.13, 2)  # 0.13 kg CO2/kWh Ontario grid
        ))
        
        # Solar energy
        energy_usage_db.append(EnergyUsage(
            timestamp=timestamp,
            kwh_used=solar_kwh,
            source_type=EnergySource.SOLAR,
            cost_cad=0,
            carbon_kg=0
        ))
        
        # Water usage (closed-loop hydroponic system)
        total_water = random.uniform(800, 1200)  # Liters per day
        recycling_rate = random.uniform(0.85, 0.95)  # 85-95% recycled
        recycled = total_water * recycling_rate
        
        water_usage_db.append(WaterUsage(
            timestamp=timestamp,
            liters_used=round(total_water, 1),
            recycled_liters=round(recycled, 1),
            efficiency_percent=round(recycling_rate * 100, 1),
            cost_cad=round((total_water - recycled) * 0.003, 2)  # $0.003/L for fresh water
        ))
        
        # Nutrient usage
        for nutrient_type in ["Base A", "Base B", "Cal-Mag"]:
            usage = random.uniform(200, 400)
            waste = usage * random.uniform(0.05, 0.15)  # 5-15% waste
            
            nutrient_usage_db.append(NutrientUsage(
                timestamp=timestamp,
                nutrient_type=nutrient_type,
                volume_ml=round(usage, 1),
                waste_ml=round(waste, 1),
                efficiency_percent=round(((usage - waste) / usage) * 100, 1)
            ))
        
        # Waste tracking (weekly batches)
        if day % 7 == 0:
            # Organic waste (plant trimmings, unusable plants)
            organic_weight = random.uniform(15, 25)
            composted = organic_weight * random.uniform(0.90, 1.0)
            
            waste_tracking_db.append(WasteTracking(
                date=date.isoformat(),
                waste_type=WasteType.ORGANIC,
                weight_kg=round(organic_weight, 2),
                recycled_kg=0,
                composted_kg=round(composted, 2),
                landfill_kg=round(organic_weight - composted, 2)
            ))
            
            # Packaging waste
            packaging_weight = random.uniform(3, 6)
            recycled_packaging = packaging_weight * random.uniform(0.70, 0.85)
            
            waste_tracking_db.append(WasteTracking(
                date=date.isoformat(),
                waste_type=WasteType.PACKAGING,
                weight_kg=round(packaging_weight, 2),
                recycled_kg=round(recycled_packaging, 2),
                composted_kg=0,
                landfill_kg=round(packaging_weight - recycled_packaging, 2)
            ))
        
        # Carbon footprint
        water_carbon = (total_water - recycled) * 0.0004  # kg CO2 per liter fresh water
        transport_carbon = random.uniform(5, 15)  # Delivery carbon footprint
        
        carbon_footprint_db.append(CarbonFootprint(
            date=date.isoformat(),
            energy_carbon_kg=round(grid_kwh * 0.13, 2),
            water_carbon_kg=round(water_carbon, 2),
            transport_carbon_kg=round(transport_carbon, 2),
            total_kg=round(grid_kwh * 0.13 + water_carbon + transport_carbon, 2)
        ))

# Initialize demo data on module load
generate_demo_data()

# ============================================================================
# REAL DATA INTEGRATION
# ============================================================================

async def fetch_transport_carbon_from_orders(days: int = 30) -> List[CarbonFootprint]:
    """Fetch real transport carbon data from wholesale orders"""
    if not ENABLE_REAL_DATA:
        return []
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{NODE_API_URL}/api/sustainability/transport-carbon",
                params={"days": days}
            )
            if response.status_code == 200:
                data = response.json()
                if data.get("ok"):
                    # Convert to CarbonFootprint objects
                    return [
                        CarbonFootprint(
                            date=entry["date"],
                            energy_carbon_kg=0,  # Not from orders
                            water_carbon_kg=0,   # Not from orders
                            transport_carbon_kg=entry["carbon_kg"],
                            total_kg=entry["carbon_kg"]
                        )
                        for entry in data.get("daily_carbon", [])
                    ]
    except Exception as e:
        print(f"[Sustainability] Could not fetch transport carbon: {e}")
    
    return []

async def fetch_nutrient_usage_from_logs(days: int = 30) -> List[NutrientUsage]:
    """Fetch real nutrient usage from automation/management logs"""
    if not ENABLE_REAL_DATA:
        return []
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{NODE_API_URL}/api/sustainability/nutrient-usage",
                params={"days": days}
            )
            if response.status_code == 200:
                data = response.json()
                if data.get("ok"):
                    return [
                        NutrientUsage(
                            timestamp=entry["timestamp"],
                            nutrient_type=entry["nutrient_type"],
                            volume_ml=entry["volume_ml"],
                            waste_ml=entry.get("waste_ml", 0),
                            efficiency_percent=entry.get("efficiency_percent", 100)
                        )
                        for entry in data.get("usage", [])
                    ]
    except Exception as e:
        print(f"[Sustainability] Could not fetch nutrient usage: {e}")
    
    return []

def merge_carbon_data(demo_data: List[CarbonFootprint], real_transport: List[CarbonFootprint]) -> List[CarbonFootprint]:
    """Merge demo energy/water carbon with real transport carbon"""
    if not real_transport:
        return demo_data
    
    # Create lookup by date for real transport data
    transport_by_date = {entry.date: entry.transport_carbon_kg for entry in real_transport}
    
    # Update demo data with real transport carbon
    merged = []
    for entry in demo_data:
        if entry.date in transport_by_date:
            # Replace demo transport with real transport
            real_transport_kg = transport_by_date[entry.date]
            merged.append(CarbonFootprint(
                date=entry.date,
                energy_carbon_kg=entry.energy_carbon_kg,
                water_carbon_kg=entry.water_carbon_kg,
                transport_carbon_kg=real_transport_kg,
                total_kg=entry.energy_carbon_kg + entry.water_carbon_kg + real_transport_kg
            ))
        else:
            merged.append(entry)
    
    return merged

# Initialize demo data on module load
generate_demo_data()

# ============================================================================
# ESG SCORING ALGORITHM
# ============================================================================

async def calculate_esg_score() -> dict:
    """
    Calculate ESG score (0-100) based on available efficiency metrics
    
    SCALABLE SCORING:
    - Only scores metrics that are actually measured
    - Redistributes points proportionally if some metrics missing
    - Small farms can skip waste/energy/water tracking
    - Core metrics: transport carbon (orders) + nutrients (automation)
    
    Maximum points per category:
    - Energy Efficiency (30 points): Renewable % + efficiency
    - Water Efficiency (25 points): Recycling rate  
    - Nutrient Efficiency (20 points): Waste reduction
    - Waste Management (15 points): Composting/recycling rate [OPTIONAL]
    - Carbon Footprint (10 points): Low emissions
    """
    
    # Get last 30 days of data
    cutoff_date = datetime.now() - timedelta(days=30)
    
    # Track which metrics are available
    available_metrics = {}
    scores = {}
    
    # Energy score (30 points) - OPTIONAL
    recent_energy = [e for e in energy_usage_db if datetime.fromisoformat(e.timestamp) >= cutoff_date]
    if recent_energy:
        total_kwh = sum(e.kwh_used for e in recent_energy)
        solar_kwh = sum(e.kwh_used for e in recent_energy if e.source_type == EnergySource.SOLAR)
        renewable_percent = (solar_kwh / total_kwh * 100) if total_kwh > 0 else 0
        scores["energy"] = min(30, renewable_percent * 0.75)
        available_metrics["renewable_energy_percent"] = round(renewable_percent, 1)
    else:
        scores["energy"] = None
        available_metrics["renewable_energy_percent"] = None
    
    # Water score (25 points) - OPTIONAL
    recent_water = [w for w in water_usage_db if datetime.fromisoformat(w.timestamp) >= cutoff_date]
    if recent_water:
        avg_water_efficiency = sum(w.efficiency_percent for w in recent_water) / len(recent_water)
        scores["water"] = (avg_water_efficiency / 100) * 25
        available_metrics["water_recycling_percent"] = round(avg_water_efficiency, 1)
    else:
        scores["water"] = None
        available_metrics["water_recycling_percent"] = None
    
    # Nutrient score (20 points) - Try to get real data
    real_nutrients = await fetch_nutrient_usage_from_logs(30)
    recent_nutrients = real_nutrients if real_nutrients else [n for n in nutrient_usage_db if datetime.fromisoformat(n.timestamp) >= cutoff_date]
    
    if recent_nutrients:
        avg_nutrient_efficiency = sum(n.efficiency_percent for n in recent_nutrients) / len(recent_nutrients)
        scores["nutrients"] = (avg_nutrient_efficiency / 100) * 20
        available_metrics["nutrient_efficiency_percent"] = round(avg_nutrient_efficiency, 1)
        available_metrics["nutrient_data_source"] = "real_logs" if real_nutrients else "estimated"
    else:
        scores["nutrients"] = None
        available_metrics["nutrient_efficiency_percent"] = None
        available_metrics["nutrient_data_source"] = "none"
    
    # Waste score (15 points) - OPTIONAL (small farms don't track this)
    recent_waste = [w for w in waste_tracking_db if datetime.fromisoformat(w.date) >= cutoff_date.date().isoformat()]
    if recent_waste:
        total_waste = sum(w.weight_kg for w in recent_waste)
        diverted_waste = sum(w.recycled_kg + w.composted_kg for w in recent_waste)
        diversion_rate = (diverted_waste / total_waste * 100) if total_waste > 0 else 0
        scores["waste"] = (diversion_rate / 100) * 15
        available_metrics["waste_diversion_percent"] = round(diversion_rate, 1)
    else:
        scores["waste"] = None  # Skip waste for small farms
        available_metrics["waste_diversion_percent"] = None
    
    # Carbon score (10 points) - Use real transport data
    real_transport = await fetch_transport_carbon_from_orders(30)
    merged_carbon_db = merge_carbon_data(carbon_footprint_db, real_transport)
    recent_carbon = [c for c in merged_carbon_db if datetime.fromisoformat(c.date) >= cutoff_date.date().isoformat()]
    
    if recent_carbon:
        avg_daily_carbon = sum(c.total_kg for c in recent_carbon) / len(recent_carbon)
        scores["carbon"] = max(0, min(10, 10 - ((avg_daily_carbon - 50) / 15)))
        available_metrics["avg_daily_carbon_kg"] = round(avg_daily_carbon, 1)
        available_metrics["carbon_data_source"] = "real_orders" if real_transport else "estimated"
    else:
        scores["carbon"] = None
        available_metrics["avg_daily_carbon_kg"] = None
        available_metrics["carbon_data_source"] = "none"
    
    # Calculate total score from available metrics only
    valid_scores = {k: v for k, v in scores.items() if v is not None}
    
    if not valid_scores:
        # No data available at all
        total_score = 0
        grade = "N/A"
    else:
        # Calculate weighted average based on available metrics
        # Redistribute points proportionally
        max_possible = sum([30, 25, 20, 15, 10])  # Total 100 points
        available_max = {
            "energy": 30,
            "water": 25,
            "nutrients": 20,
            "waste": 15,
            "carbon": 10
        }
        total_available = sum(available_max[k] for k in valid_scores.keys())
        
        # Scale scores to 100-point scale
        total_score = sum(valid_scores.values()) * (100 / total_available) if total_available > 0 else 0
        total_score = round(total_score, 1)
        grade = get_esg_grade(total_score)
    
    return {
        "total_score": total_score,
        "grade": grade,
        "breakdown": {
            "energy": round(scores["energy"], 1) if scores["energy"] is not None else None,
            "water": round(scores["water"], 1) if scores["water"] is not None else None,
            "nutrients": round(scores["nutrients"], 1) if scores["nutrients"] is not None else None,
            "waste": round(scores["waste"], 1) if scores["waste"] is not None else None,
            "carbon": round(scores["carbon"], 1) if scores["carbon"] is not None else None
        },
        "metrics": available_metrics,
        "data_availability": {
            "energy": scores["energy"] is not None,
            "water": scores["water"] is not None,
            "nutrients": scores["nutrients"] is not None,
            "waste": scores["waste"] is not None,
            "carbon": scores["carbon"] is not None,
            "tracked_count": len(valid_scores),
            "total_possible": 5
        }
    }

def get_esg_grade(score: float) -> str:
    """Convert ESG score to letter grade"""
    if score >= 90:
        return "A+"
    elif score >= 85:
        return "A"
    elif score >= 80:
        return "A-"
    elif score >= 75:
        return "B+"
    elif score >= 70:
        return "B"
    elif score >= 65:
        return "B-"
    elif score >= 60:
        return "C+"
    elif score >= 55:
        return "C"
    else:
        return "C-"

# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/energy/usage")
async def get_energy_usage(days: int = Query(30, ge=1, le=365)):
    """Get energy usage data for specified days"""
    cutoff = datetime.now() - timedelta(days=days)
    recent = [e for e in energy_usage_db if datetime.fromisoformat(e.timestamp) >= cutoff]
    
    # Aggregate by source
    by_source = {}
    for entry in recent:
        source = entry.source_type.value
        if source not in by_source:
            by_source[source] = {"kwh": 0, "cost": 0, "carbon_kg": 0, "count": 0}
        by_source[source]["kwh"] += entry.kwh_used
        by_source[source]["cost"] += entry.cost_cad
        by_source[source]["carbon_kg"] += entry.carbon_kg
        by_source[source]["count"] += 1
    
    total_kwh = sum(e.kwh_used for e in recent)
    total_cost = sum(e.cost_cad for e in recent)
    total_carbon = sum(e.carbon_kg for e in recent)
    
    return {
        "ok": True,
        "period_days": days,
        "total_kwh": round(total_kwh, 2),
        "total_cost_cad": round(total_cost, 2),
        "total_carbon_kg": round(total_carbon, 2),
        "by_source": by_source,
        "daily_average_kwh": round(total_kwh / days, 2),
        "data_points": len(recent)
    }

@router.get("/water/usage")
async def get_water_usage(days: int = Query(30, ge=1, le=365)):
    """Get water usage data for specified days"""
    cutoff = datetime.now() - timedelta(days=days)
    recent = [w for w in water_usage_db if datetime.fromisoformat(w.timestamp) >= cutoff]
    
    total_used = sum(w.liters_used for w in recent)
    total_recycled = sum(w.recycled_liters for w in recent)
    avg_efficiency = sum(w.efficiency_percent for w in recent) / len(recent) if recent else 0
    total_cost = sum(w.cost_cad for w in recent)
    
    return {
        "ok": True,
        "period_days": days,
        "total_liters_used": round(total_used, 1),
        "total_liters_recycled": round(total_recycled, 1),
        "average_efficiency_percent": round(avg_efficiency, 1),
        "total_cost_cad": round(total_cost, 2),
        "daily_average_liters": round(total_used / days, 1),
        "data_points": len(recent)
    }

@router.get("/nutrients/efficiency")
async def get_nutrient_efficiency(days: int = Query(30, ge=1, le=365)):
    """Get nutrient efficiency data - uses real data from automation logs when available"""
    global nutrient_usage_db
    
    # Try to fetch real nutrient data
    real_nutrients = await fetch_nutrient_usage_from_logs(days)
    
    # Use real data if available, otherwise fall back to demo
    data_source = nutrient_usage_db
    if real_nutrients:
        data_source = real_nutrients
    
    cutoff = datetime.now() - timedelta(days=days)
    recent = [n for n in data_source if datetime.fromisoformat(n.timestamp) >= cutoff]
    
    if not recent:
        return {
            "ok": True,
            "period_days": days,
            "by_nutrient_type": {},
            "overall_efficiency": 0,
            "data_sources": {"nutrients": "none_available"}
        }
    
    by_type = {}
    for entry in recent:
        ntype = entry.nutrient_type
        if ntype not in by_type:
            by_type[ntype] = {"volume_ml": 0, "waste_ml": 0, "count": 0}
        by_type[ntype]["volume_ml"] += entry.volume_ml
        by_type[ntype]["waste_ml"] += entry.waste_ml
        by_type[ntype]["count"] += 1
    
    # Calculate efficiency for each type
    for ntype in by_type:
        total_vol = by_type[ntype]["volume_ml"]
        total_waste = by_type[ntype]["waste_ml"]
        by_type[ntype]["efficiency_percent"] = round(((total_vol - total_waste) / total_vol * 100), 1) if total_vol > 0 else 0
    
    return {
        "ok": True,
        "period_days": days,
        "by_nutrient_type": by_type,
        "overall_efficiency": round(sum(n.efficiency_percent for n in recent) / len(recent), 1) if recent else 0,
        "data_sources": {
            "nutrients": "real_logs" if real_nutrients else "estimated"
        }
    }

@router.get("/waste/tracking")
async def get_waste_tracking(days: int = Query(30, ge=1, le=365)):
    """Get waste tracking data"""
    cutoff = (datetime.now() - timedelta(days=days)).date()
    recent = [w for w in waste_tracking_db if datetime.fromisoformat(w.date).date() >= cutoff]
    
    by_type = {}
    for entry in recent:
        wtype = entry.waste_type.value
        if wtype not in by_type:
            by_type[wtype] = {"total_kg": 0, "recycled_kg": 0, "composted_kg": 0, "landfill_kg": 0}
        by_type[wtype]["total_kg"] += entry.weight_kg
        by_type[wtype]["recycled_kg"] += entry.recycled_kg
        by_type[wtype]["composted_kg"] += entry.composted_kg
        by_type[wtype]["landfill_kg"] += entry.landfill_kg
    
    total_waste = sum(w.weight_kg for w in recent)
    total_diverted = sum(w.recycled_kg + w.composted_kg for w in recent)
    diversion_rate = (total_diverted / total_waste * 100) if total_waste > 0 else 0
    
    return {
        "ok": True,
        "period_days": days,
        "total_waste_kg": round(total_waste, 2),
        "total_diverted_kg": round(total_diverted, 2),
        "diversion_rate_percent": round(diversion_rate, 1),
        "by_waste_type": by_type
    }

@router.get("/carbon-footprint")
async def get_carbon_footprint(days: int = Query(30, ge=1, le=365)):
    """Get carbon footprint data - merges demo energy/water with real transport data"""
    global carbon_footprint_db
    
    # Fetch real transport carbon from wholesale orders
    real_transport = await fetch_transport_carbon_from_orders(days)
    
    # Merge with demo data (or use demo only if no real data)
    merged_carbon_db = merge_carbon_data(carbon_footprint_db, real_transport)
    
    cutoff = (datetime.now() - timedelta(days=days)).date()
    recent = [c for c in merged_carbon_db if datetime.fromisoformat(c.date).date() >= cutoff]
    
    total_energy = sum(c.energy_carbon_kg for c in recent)
    total_water = sum(c.water_carbon_kg for c in recent)
    total_transport = sum(c.transport_carbon_kg for c in recent)
    total_carbon = sum(c.total_kg for c in recent)
    
    # Check if we have real transport data
    has_real_transport = len(real_transport) > 0
    
    return {
        "ok": True,
        "period_days": days,
        "total_carbon_kg": round(total_carbon, 2),
        "breakdown": {
            "energy_kg": round(total_energy, 2),
            "water_kg": round(total_water, 2),
            "transport_kg": round(total_transport, 2)
        },
        "daily_average_kg": round(total_carbon / days if days > 0 else 0, 2),
        "monthly_projection_kg": round((total_carbon / days if days > 0 else 0) * 30, 2),
        "data_sources": {
            "transport": "real_orders" if has_real_transport else "estimated",
            "energy": "estimated",
            "water": "estimated"
        }
    }

@router.get("/esg-report")
async def get_esg_report():
    """Generate comprehensive ESG report for investors - uses real data when available"""
    esg_score = await calculate_esg_score()
    
    # Get 30-day summaries
    energy_data = await get_energy_usage(30)
    water_data = await get_water_usage(30)
    nutrient_data = await get_nutrient_efficiency(30)
    waste_data = await get_waste_tracking(30)
    carbon_data = await get_carbon_footprint(30)
    
    # Build environmental metrics, handling missing data gracefully
    environmental_metrics = {}
    
    if esg_score["metrics"].get("renewable_energy_percent") is not None:
        environmental_metrics["energy"] = {
            "total_kwh": energy_data["total_kwh"],
            "renewable_percent": esg_score["metrics"]["renewable_energy_percent"],
            "carbon_kg": energy_data["total_carbon_kg"],
            "data_source": "estimated"
        }
    
    if esg_score["metrics"].get("water_recycling_percent") is not None:
        environmental_metrics["water"] = {
            "total_liters": water_data["total_liters_used"],
            "recycling_percent": water_data["average_efficiency_percent"],
            "cost_savings": round(water_data["total_liters_recycled"] * 0.003, 2),
            "data_source": "estimated"
        }
    
    if esg_score["metrics"].get("nutrient_efficiency_percent") is not None:
        environmental_metrics["nutrients"] = {
            "efficiency_percent": esg_score["metrics"]["nutrient_efficiency_percent"],
            "data_source": esg_score["metrics"].get("nutrient_data_source", "estimated")
        }
    
    if esg_score["metrics"].get("waste_diversion_percent") is not None:
        environmental_metrics["waste"] = {
            "total_kg": waste_data["total_waste_kg"],
            "diversion_rate": waste_data["diversion_rate_percent"],
            "landfill_kg": round(waste_data["total_waste_kg"] - waste_data["total_diverted_kg"], 2),
            "data_source": "manual_entry"
        }
    
    if esg_score["metrics"].get("avg_daily_carbon_kg") is not None:
        environmental_metrics["carbon_footprint"] = {
            "total_kg": carbon_data["total_carbon_kg"],
            "daily_average": carbon_data["daily_average_kg"],
            "annual_projection_kg": round(carbon_data["daily_average_kg"] * 365, 2),
            "data_source": carbon_data.get("data_sources", {}).get("transport", "estimated")
        }
    
    # Build sustainability goals based on available metrics
    sustainability_goals = {}
    
    if esg_score["metrics"].get("renewable_energy_percent") is not None:
        sustainability_goals["renewable_energy"] = {
            "target": "40%",
            "current": f"{esg_score['metrics']['renewable_energy_percent']}%"
        }
    
    if esg_score["metrics"].get("water_recycling_percent") is not None:
        sustainability_goals["water_recycling"] = {
            "target": "95%",
            "current": f"{esg_score['metrics']['water_recycling_percent']}%"
        }
    
    if esg_score["metrics"].get("waste_diversion_percent") is not None:
        sustainability_goals["waste_diversion"] = {
            "target": "90%",
            "current": f"{esg_score['metrics']['waste_diversion_percent']}%"
        }
    
    return {
        "ok": True,
        "report_date": datetime.now().isoformat(),
        "reporting_period": "Last 30 days",
        "esg_score": esg_score,
        "environmental_metrics": environmental_metrics,
        "sustainability_goals": sustainability_goals,
        "note": f"Tracking {esg_score['data_availability']['tracked_count']} of 5 possible metrics. Small farms can focus on transport carbon and nutrients."
    }

@router.get("/dashboard")
async def get_sustainability_dashboard():
    """Get real-time sustainability dashboard data"""
    esg_score = await calculate_esg_score()
    
    # Today's data
    today = datetime.now().date()
    today_energy = [e for e in energy_usage_db if datetime.fromisoformat(e.timestamp).date() == today]
    today_water = [w for w in water_usage_db if datetime.fromisoformat(w.timestamp).date() == today]
    
    today_kwh = sum(e.kwh_used for e in today_energy)
    today_energy_cost = sum(e.cost_cad for e in today_energy)
    today_water_liters = sum(w.liters_used for w in today_water)
    today_water_efficiency = sum(w.efficiency_percent for w in today_water) / len(today_water) if today_water else 0
    
    return {
        "ok": True,
        "esg_score": esg_score,
        "today": {
            "energy_kwh": round(today_kwh, 2),
            "energy_cost_cad": round(today_energy_cost, 2),
            "water_liters": round(today_water_liters, 1),
            "water_efficiency_percent": round(today_water_efficiency, 1)
        },
        "this_month": {
            "days": 30,
            "summary": "Use /sustainability/esg-report for detailed monthly data"
        }
    }

@router.get("/trends")
async def get_sustainability_trends(days: int = Query(30, ge=7, le=90)):
    """Get sustainability trend data for charts"""
    cutoff = datetime.now() - timedelta(days=days)
    
    # Daily aggregates for charts
    daily_data = {}
    
    # Energy trends
    for entry in energy_usage_db:
        dt = datetime.fromisoformat(entry.timestamp)
        if dt < cutoff:
            continue
        date_key = dt.date().isoformat()
        if date_key not in daily_data:
            daily_data[date_key] = {
                "date": date_key,
                "energy_kwh": 0,
                "energy_cost": 0,
                "water_liters": 0,
                "water_recycled": 0,
                "carbon_kg": 0
            }
        daily_data[date_key]["energy_kwh"] += entry.kwh_used
        daily_data[date_key]["energy_cost"] += entry.cost_cad
    
    # Water trends
    for entry in water_usage_db:
        dt = datetime.fromisoformat(entry.timestamp)
        if dt < cutoff:
            continue
        date_key = dt.date().isoformat()
        if date_key in daily_data:
            daily_data[date_key]["water_liters"] += entry.liters_used
            daily_data[date_key]["water_recycled"] += entry.recycled_liters
    
    # Carbon trends
    for entry in carbon_footprint_db:
        date_key = entry.date
        if datetime.fromisoformat(date_key).date() < cutoff.date():
            continue
        if date_key in daily_data:
            daily_data[date_key]["carbon_kg"] = entry.total_kg
    
    # Convert to sorted list
    trend_data = sorted(daily_data.values(), key=lambda x: x["date"])
    
    return {
        "ok": True,
        "period_days": days,
        "data_points": len(trend_data),
        "trends": trend_data
    }
