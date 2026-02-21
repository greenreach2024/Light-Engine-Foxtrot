"""
Production Planning Module - Forecast & Schedule Planting
AI-driven planning based on sales demand and grow cycles
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import statistics
import httpx

router = APIRouter()

# Node.js server URL for fetching real data
NODE_API_URL = "http://localhost:8091"


async def load_dedicated_crops() -> List[str]:
    """Load dedicated crop list from the Node.js farm config endpoint.
    Returns empty list if unavailable (meaning no restriction)."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{NODE_API_URL}/api/farm/dedicated-crops")
            data = response.json()
            if data.get("ok") and not data.get("unrestricted"):
                return [dc["name"] if isinstance(dc, dict) else dc for dc in data.get("dedicated_crops", [])]
    except Exception as e:
        print(f"[Planning] Could not load dedicated crops: {e}")
    return []

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

async def fetch_wholesale_order_history(days: int = 60) -> List[Dict]:
    """Fetch real wholesale order history from Node.js server"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{NODE_API_URL}/api/wholesale/orders/history?days={days}")
            data = response.json()
            if data.get("ok") and data.get("sales_history"):
                return data["sales_history"]
            return []
    except Exception as e:
        print(f"[Planning] Could not fetch wholesale history: {e}")
        return []

# ============================================================================
# MODELS
# ============================================================================

class PlanningHorizon(str, Enum):
    """Planning time horizons"""
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"

class CreatePlan(BaseModel):
    """Create production plan"""
    crop_name: str
    target_date: str
    target_quantity: int
    unit: str
    priority: Optional[int] = 1  # 1=high, 2=medium, 3=low
    notes: Optional[str] = None

class PlantingSchedule(BaseModel):
    """Generated planting schedule"""
    crop_name: str
    variety: Optional[str] = None
    seed_date: str
    transplant_date: Optional[str] = None
    harvest_date: str
    quantity: int
    reason: str  # Why this planting is recommended

# ============================================================================
# CROP GROWTH DATABASE
# ============================================================================

CROP_DATA = {
    "Buttercrunch Lettuce": {
        "days_to_germinate": 3,
        "days_to_transplant": 7,
        "days_to_harvest": 28,
        "success_rate": 0.95,
        "avg_yield_per_plant": 0.25,  # kg
        "space_per_plant": 1  # cells
    },
    "Arugula": {
        "days_to_germinate": 2,
        "days_to_transplant": 0,  # Direct seed
        "days_to_harvest": 21,
        "success_rate": 0.92,
        "avg_yield_per_plant": 0.15,
        "space_per_plant": 1
    },
    "Basil": {
        "days_to_germinate": 5,
        "days_to_transplant": 14,
        "days_to_harvest": 35,
        "success_rate": 0.88,
        "avg_yield_per_plant": 0.20,
        "space_per_plant": 1
    },
    "Cherry Tomatoes": {
        "days_to_germinate": 7,
        "days_to_transplant": 21,
        "days_to_harvest": 65,
        "success_rate": 0.85,
        "avg_yield_per_plant": 2.5,
        "space_per_plant": 4
    },
    "Kale": {
        "days_to_germinate": 4,
        "days_to_transplant": 14,
        "days_to_harvest": 35,
        "success_rate": 0.90,
        "avg_yield_per_plant": 0.30,
        "space_per_plant": 1
    },
    "Microgreens": {
        "days_to_germinate": 1,
        "days_to_transplant": 0,
        "days_to_harvest": 10,
        "success_rate": 0.95,
        "avg_yield_per_plant": 0.05,
        "space_per_plant": 0.5
    }
}

# ============================================================================
# DATABASE (PLACEHOLDER)
# ============================================================================

class PlanningDatabase:
    """In-memory database placeholder"""
    
    def __init__(self):
        self.plans = {}
        self.schedules = {}
        self.sales_history = []
        self.real_wholesale_data_loaded = False
        self._init_demo_data()
    
    async def load_real_wholesale_data(self):
        """Load real wholesale order data and merge with demo data"""
        if self.real_wholesale_data_loaded:
            return
        
        real_orders = await fetch_wholesale_order_history(days=60)
        
        if real_orders:
            print(f"[Planning] Loaded {len(real_orders)} real wholesale orders")
            # Add real orders to history (they take precedence)
            self.sales_history.extend(real_orders)
            self.real_wholesale_data_loaded = True
        else:
            print("[Planning] No real wholesale orders found, using demo data only")
    
    def _init_demo_data(self):
        """Initialize with demo sales data (fallback/supplement) - controlled by demo_config.py"""
        from .demo_config import should_use_demo_data
        if not should_use_demo_data("production_planning"):
            return  # Skip demo data in production
        # Simulate 60 days of sales history
        today = datetime.now()
        
        crops = ["Buttercrunch Lettuce", "Arugula", "Basil", "Kale"]
        
        for i in range(60):
            date = (today - timedelta(days=i)).strftime("%Y-%m-%d")
            
            # Random sales for each crop (simulate demand patterns)
            for crop in crops:
                # Higher demand on weekends
                weekday = (today - timedelta(days=i)).weekday()
                base_demand = 5 if weekday < 5 else 12
                
                # Growing trend over time (business growing)
                growth_factor = 1.0 + (i / 200)
                
                quantity = int(base_demand * growth_factor)
                
                self.sales_history.append({
                    "date": date,
                    "crop": crop,
                    "quantity": quantity,
                    "unit": "kg"
                })

db = PlanningDatabase()

# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.get("/api/planning/demand-forecast")
async def get_demand_forecast(crop: Optional[str] = None, horizon: str = "monthly"):
    """Get demand forecast based on sales history"""
    
    # Load real wholesale order data
    await db.load_real_wholesale_data()
    
    # Filter sales by crop if specified
    sales = db.sales_history
    if crop:
        sales = [s for s in sales if s["crop"] == crop]
    
    # Group by crop
    crop_totals = {}
    for sale in sales:
        crop_name = sale["crop"]
        if crop_name not in crop_totals:
            crop_totals[crop_name] = []
        crop_totals[crop_name].append(sale["quantity"])
    
    # Calculate forecasts
    forecasts = []
    for crop_name, quantities in crop_totals.items():
        # Recent trend (last 14 days avg)
        recent = quantities[:14]
        recent_avg = statistics.mean(recent) if recent else 0
        
        # Overall average
        overall_avg = statistics.mean(quantities) if quantities else 0
        
        # Calculate growth rate
        first_half = quantities[len(quantities)//2:]
        second_half = quantities[:len(quantities)//2]
        first_avg = statistics.mean(first_half) if first_half else 1
        second_avg = statistics.mean(second_half) if second_half else 1
        growth_rate = ((second_avg - first_avg) / first_avg) if first_avg > 0 else 0
        
        # Forecast next period
        if horizon == "weekly":
            forecast = recent_avg * 7
            period = "next 7 days"
        elif horizon == "monthly":
            forecast = recent_avg * 30
            period = "next 30 days"
        elif horizon == "quarterly":
            forecast = recent_avg * 90
            period = "next 90 days"
        else:
            forecast = recent_avg * 365
            period = "next year"
        
        forecasts.append({
            "crop": crop_name,
            "period": period,
            "forecasted_demand": round(forecast, 1),
            "forecasted_quantity": round(forecast, 1),
            "unit": "kg",
            "daily_average": round(recent_avg, 1),
            "current_avg_daily": round(recent_avg, 1),
            "growth_rate": round(growth_rate * 100, 1),
            "trend": "growing" if growth_rate > 0.02 else "stable" if growth_rate > -0.02 else "declining",
            "confidence": "high" if len(quantities) > 30 else "medium" if len(quantities) > 10 else "low"
        })
    
    # Sort by forecasted demand
    forecasts.sort(key=lambda x: x["forecasted_demand"], reverse=True)
    
    return {
        "ok": True,
        "forecasts": forecasts,
        "data_points": len(sales),
        "horizon": horizon,
        "data_source": "real_wholesale_orders" if db.real_wholesale_data_loaded else "demo_data",
        "real_orders_count": len([s for s in db.sales_history if s not in db.sales_history[:len(db.sales_history)//2]]) if db.real_wholesale_data_loaded else 0
    }

@router.post("/api/planning/schedule/generate")
async def generate_planting_schedule(horizon: str = "monthly", crops: Optional[str] = Query(None, description="Comma-separated crop names to filter by")):
    """Generate recommended planting schedule based on demand.
    Optional 'crops' param restricts to specific crops (comma-separated).
    If omitted, uses farm's dedicated crop list when available."""
    
    # Resolve crop filter
    crop_filter = None
    if crops:
        crop_filter = set(c.strip() for c in crops.split(",") if c.strip())
    else:
        dedicated = await load_dedicated_crops()
        if dedicated:
            crop_filter = set(dedicated)
    
    # Get demand forecast
    forecast_response = await get_demand_forecast(horizon=horizon)
    forecasts = forecast_response["forecasts"]
    
    schedule = []
    today = datetime.now()
    
    for forecast in forecasts:
        crop = forecast["crop"]
        demand_kg = forecast["forecasted_demand"]
        
        if crop not in CROP_DATA:
            continue
        
        # Apply dedicated crop filter if set
        if crop_filter and crop not in crop_filter:
            continue
        
        crop_info = CROP_DATA[crop]
        
        # Calculate how many plants needed
        plants_needed = int(demand_kg / crop_info["avg_yield_per_plant"] / crop_info["success_rate"])
        
        # Calculate dates
        days_to_harvest = (crop_info["days_to_germinate"] + 
                          crop_info["days_to_transplant"] + 
                          crop_info["days_to_harvest"])
        
        seed_date = today
        transplant_date = seed_date + timedelta(days=crop_info["days_to_transplant"]) if crop_info["days_to_transplant"] > 0 else None
        harvest_date = seed_date + timedelta(days=days_to_harvest)
        
        # Generate multiple planting windows for continuous harvest
        num_plantings = 4 if horizon == "monthly" else 2
        planting_interval = 7 if horizon == "monthly" else 14
        
        for i in range(num_plantings):
            planting_seed_date = seed_date + timedelta(days=i * planting_interval)
            planting_harvest_date = planting_seed_date + timedelta(days=days_to_harvest)
            planting_transplant = planting_seed_date + timedelta(days=crop_info["days_to_transplant"]) if crop_info["days_to_transplant"] > 0 else None
            
            schedule.append({
                "crop": crop,
                "seed_date": planting_seed_date.strftime("%Y-%m-%d"),
                "transplant_date": planting_transplant.strftime("%Y-%m-%d") if planting_transplant else None,
                "harvest_date": planting_harvest_date.strftime("%Y-%m-%d"),
                "quantity": plants_needed // num_plantings,
                "space_required": (plants_needed // num_plantings) * crop_info["space_per_plant"],
                "expected_yield_kg": round((plants_needed // num_plantings) * crop_info["avg_yield_per_plant"] * crop_info["success_rate"], 1),
                "reason": f"Meet forecasted demand of {demand_kg}kg ({forecast['trend']} trend)",
                "priority": 1 if forecast["trend"] == "growing" else 2
            })
    
    # Sort by seed date
    schedule.sort(key=lambda x: x["seed_date"])
    
    return {
        "ok": True,
        "schedule": schedule,
        "total_plantings": len(schedule),
        "horizon": horizon
    }

@router.get("/api/planning/capacity")
async def get_capacity_analysis():
    """Analyze current capacity and utilization"""
    
    # Get current batches (from traceability system)
    from backend.batch_traceability import db as batch_db
    
    active_batches = [b for b in batch_db.batches.values() 
                     if b["status"] in ["seeded", "germinating", "transplanted", "growing"]]
    
    # Calculate space usage
    total_space_used = 0
    crops_in_production = {}
    
    for batch in active_batches:
        crop = batch["crop_name"]
        quantity = batch["quantity"]
        
        if crop in CROP_DATA:
            space = quantity * CROP_DATA[crop]["space_per_plant"]
            total_space_used += space
            
            if crop not in crops_in_production:
                crops_in_production[crop] = 0
            crops_in_production[crop] += quantity
    
    # Assumed total capacity (configurable in real system)
    total_capacity = 2000  # cells/spaces
    utilization = (total_space_used / total_capacity) * 100
    
    # Calculate upcoming harvests (next 7 days)
    today = datetime.now()
    upcoming_harvests = []
    
    for batch in active_batches:
        if "expected_harvest_date" in batch and batch["expected_harvest_date"]:
            harvest_date = datetime.fromisoformat(batch["expected_harvest_date"])
            days_until = (harvest_date - today).days
            
            if 0 <= days_until <= 7:
                crop = batch["crop_name"]
                expected_yield = 0
                if crop in CROP_DATA:
                    expected_yield = batch["quantity"] * CROP_DATA[crop]["avg_yield_per_plant"] * CROP_DATA[crop]["success_rate"]
                
                upcoming_harvests.append({
                    "batch_id": batch["batch_id"],
                    "crop": crop,
                    "harvest_date": batch["expected_harvest_date"],
                    "days_until": days_until,
                    "expected_yield_kg": round(expected_yield, 1)
                })
    
    upcoming_harvests.sort(key=lambda x: x["days_until"])
    
    return {
        "ok": True,
        "capacity": {
            "total_capacity": total_capacity,
            "space_used": round(total_space_used, 0),
            "space_available": round(total_capacity - total_space_used, 0),
            "utilization_percent": round(utilization, 1),
            "utilization_percentage": round(utilization, 1),
            "cells_occupied": round(total_space_used, 0),
            "upcoming_harvests_next_7_days": len(upcoming_harvests),
            "status": "optimal" if 60 <= utilization <= 85 else "low" if utilization < 60 else "high"
        },
        "production": {
            "active_batches": len(active_batches),
            "crops_in_production": crops_in_production,
            "upcoming_harvests": upcoming_harvests
        }
    }

@router.post("/api/planning/plans/create")
async def create_production_plan(plan: CreatePlan):
    """Create custom production plan"""
    plan_id = f"PLAN-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    
    plan_data = {
        "plan_id": plan_id,
        "crop_name": plan.crop_name,
        "target_date": plan.target_date,
        "target_quantity": plan.target_quantity,
        "unit": plan.unit,
        "priority": plan.priority,
        "notes": plan.notes,
        "created_date": datetime.now().isoformat(),
        "status": "pending"
    }
    
    db.plans[plan_id] = plan_data
    
    # Calculate when to start
    if plan.crop_name in CROP_DATA:
        crop_info = CROP_DATA[plan.crop_name]
        target = datetime.fromisoformat(plan.target_date)
        days_needed = (crop_info["days_to_germinate"] + 
                      crop_info["days_to_transplant"] + 
                      crop_info["days_to_harvest"])
        seed_date = target - timedelta(days=days_needed)
        
        plan_data["recommended_seed_date"] = seed_date.strftime("%Y-%m-%d")
        plan_data["days_until_seed"] = (seed_date - datetime.now()).days
    
    return {
        "ok": True,
        "plan_id": plan_id,
        "plan": plan_data,
        "message": f"Production plan created for {plan.crop_name}"
    }

@router.get("/api/planning/plans/list")
async def list_production_plans(status: Optional[str] = None):
    """List all production plans"""
    raw_plans = list(db.plans.values())
    
    if status:
        raw_plans = [p for p in raw_plans if p["status"] == status]
    
    raw_plans.sort(key=lambda x: x["target_date"])

    plans = []
    for plan in raw_plans:
        plans.append({
            **plan,
            "crop": plan.get("crop_name"),
            "quantity": plan.get("target_quantity"),
            "created_at": plan.get("created_date")
        })
    
    return {
        "ok": True,
        "plans": plans,
        "total": len(plans)
    }

@router.get("/api/planning/recommendations")
async def get_planting_recommendations(crops: Optional[str] = Query(None, description="Comma-separated crop names to filter by")):
    """Get AI-driven planting recommendations.
    Optional 'crops' param restricts to specific crops (comma-separated).
    If omitted, uses farm's dedicated crop list when available."""
    
    # Resolve crop filter
    crop_filter = None
    if crops:
        crop_filter = set(c.strip() for c in crops.split(",") if c.strip())
    else:
        dedicated = await load_dedicated_crops()
        if dedicated:
            crop_filter = set(dedicated)
    
    # Load real wholesale order data
    await db.load_real_wholesale_data()
    
    # Get demand forecast
    forecast_response = await get_demand_forecast(horizon="monthly")
    forecasts = forecast_response["forecasts"]
    
    # Get capacity
    capacity_response = await get_capacity_analysis()
    available_space = capacity_response["capacity"]["space_available"]
    
    recommendations = []
    space_allocated = 0
    
    for forecast in forecasts:
        crop = forecast["crop"]
        
        if crop not in CROP_DATA:
            continue
        
        # Apply dedicated crop filter if set
        if crop_filter and crop not in crop_filter:
            continue
        
        crop_info = CROP_DATA[crop]
        daily_demand = forecast["daily_average"]
        
        # Calculate optimal quantity to plant
        plants_for_week = int((daily_demand * 7) / crop_info["avg_yield_per_plant"] / crop_info["success_rate"])
        space_needed = plants_for_week * crop_info["space_per_plant"]
        
        # Check if we have space
        if space_allocated + space_needed > available_space:
            continue
        
        space_allocated += space_needed
        
        # Calculate dates
        seed_date = datetime.now()
        days_to_harvest = (crop_info["days_to_germinate"] + 
                          crop_info["days_to_transplant"] + 
                          crop_info["days_to_harvest"])
        harvest_date = seed_date + timedelta(days=days_to_harvest)
        
        recommendations.append({
            "crop": crop,
            "action": "plant_now",
            "quantity": plants_for_week,
            "space_required": space_needed,
            "seed_date": seed_date.strftime("%Y-%m-%d"),
            "harvest_date": harvest_date.strftime("%Y-%m-%d"),
            "expected_yield_kg": round(plants_for_week * crop_info["avg_yield_per_plant"] * crop_info["success_rate"], 1),
            "recommended_seed_date": seed_date.strftime("%Y-%m-%d"),
            "expected_harvest_date": harvest_date.strftime("%Y-%m-%d"),
            "recommended_quantity": plants_for_week,
            "expected_yield": round(plants_for_week * crop_info["avg_yield_per_plant"] * crop_info["success_rate"], 1),
            "meets_demand_for": "7 days",
            "reason": f"High demand ({daily_demand}kg/day) with {forecast['trend']} trend",
            "priority": "high" if forecast["trend"] == "growing" else "medium"
        })
    
    # Market opportunities: crops outside dedicated list with growing demand
    market_opportunities = []
    if crop_filter:
        for forecast in forecasts:
            crop = forecast["crop"]
            if crop in CROP_DATA and crop not in crop_filter and forecast.get("trend") == "growing":
                market_opportunities.append({
                    "crop": crop,
                    "daily_demand_kg": forecast["daily_average"],
                    "trend": forecast["trend"],
                    "reason": f"Growing market demand ({forecast['daily_average']}kg/day) — consider adding to your dedicated crops"
                })
        market_opportunities = market_opportunities[:3]  # Limit to top 3
    
    return {
        "ok": True,
        "recommendations": recommendations,
        "market_opportunities": market_opportunities,
        "dedicated_crop_filter": list(crop_filter) if crop_filter else None,
        "total_space_allocated": round(space_allocated, 0),
        "space_remaining": round(available_space - space_allocated, 0)
    }

@router.get("/api/planning/crops")
async def get_crop_database():
    """Get crop growth information"""
    crops = []
    
    for crop_name, info in CROP_DATA.items():
        total_days = info["days_to_germinate"] + info["days_to_transplant"] + info["days_to_harvest"]
        
        crops.append({
            "crop_name": crop_name,
            "total_days_to_harvest": total_days,
            "yield_per_plant_kg": info["avg_yield_per_plant"],
            "success_rate_percent": info["success_rate"] * 100,
            "space_per_plant": info["space_per_plant"],
            "growth_stages": {
                "germination_days": info["days_to_germinate"],
                "transplant_days": info["days_to_transplant"],
                "growing_days": info["days_to_harvest"]
            }
        })
    
    crops.sort(key=lambda x: x["total_days_to_harvest"])
    
    return {
        "ok": True,
        "crops": crops,
        "total": len(crops)
    }
