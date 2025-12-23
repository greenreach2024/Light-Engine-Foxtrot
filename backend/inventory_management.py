"""
Advanced Inventory Management API
Comprehensive tracking for seeds, packaging, nutrients, equipment, and supplies
Includes expiration tracking, reorder alerts, and maintenance scheduling
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timedelta
from enum import Enum
import uuid

router = APIRouter()

# ============================================================================
# ENUMS
# ============================================================================

class SeedCategory(str, Enum):
    LEAFY_GREENS = "leafy_greens"
    HERBS = "herbs"
    MICROGREENS = "microgreens"
    FRUITING_CROPS = "fruiting_crops"

class PackagingType(str, Enum):
    CLAMSHELL = "clamshell"
    BAG = "bag"
    BOX = "box"
    TRAY = "tray"
    LABEL = "label"
    TAPE = "tape"

class NutrientType(str, Enum):
    BASE_A = "base_a"
    BASE_B = "base_b"
    CAL_MAG = "cal_mag"
    PH_UP = "ph_up"
    PH_DOWN = "ph_down"
    SUPPLEMENT = "supplement"

class EquipmentStatus(str, Enum):
    OPERATIONAL = "operational"
    MAINTENANCE_DUE = "maintenance_due"
    MAINTENANCE_OVERDUE = "maintenance_overdue"
    OUT_OF_SERVICE = "out_of_service"
    RETIRED = "retired"

class AlertLevel(str, Enum):
    CRITICAL = "critical"  # < 10% of reorder point
    WARNING = "warning"     # < 25% of reorder point
    LOW = "low"            # < 50% of reorder point
    NORMAL = "normal"

# ============================================================================
# MODELS
# ============================================================================

class SeedInventory(BaseModel):
    seed_id: str = Field(default_factory=lambda: f"SEED-{uuid.uuid4().hex[:8].upper()}")
    variety: str
    category: SeedCategory
    supplier: str
    lot_number: str
    quantity_grams: float
    germination_rate: float = Field(ge=0, le=100, description="Percentage 0-100")
    purchase_date: str
    expiration_date: str
    cost_per_gram: float
    storage_location: str
    notes: Optional[str] = None
    
class PackagingMaterial(BaseModel):
    packaging_id: str = Field(default_factory=lambda: f"PKG-{uuid.uuid4().hex[:8].upper()}")
    type: PackagingType
    description: str
    quantity: int
    unit: str  # "each", "roll", "case"
    reorder_point: int
    reorder_quantity: int
    supplier: str
    cost_per_unit: float
    storage_location: str
    last_restocked: str
    
class NutrientSolution(BaseModel):
    nutrient_id: str = Field(default_factory=lambda: f"NUT-{uuid.uuid4().hex[:8].upper()}")
    type: NutrientType
    brand: str
    batch_number: str
    concentration: str  # "1:100", "5:1", etc.
    volume_ml: float
    volume_remaining_ml: float
    purchase_date: str
    expiration_date: Optional[str] = None
    cost_per_ml: float
    storage_location: str
    msds_link: Optional[str] = None
    
class Equipment(BaseModel):
    equipment_id: str = Field(default_factory=lambda: f"EQ-{uuid.uuid4().hex[:8].upper()}")
    name: str
    category: str  # "HVAC", "Lighting", "Irrigation", "Monitoring"
    model: str
    serial_number: Optional[str] = None
    purchase_date: str
    warranty_expiration: Optional[str] = None
    maintenance_interval_days: int
    last_maintenance: str
    next_maintenance: str
    status: EquipmentStatus
    location: str
    notes: Optional[str] = None
    
class SupplyItem(BaseModel):
    supply_id: str = Field(default_factory=lambda: f"SUP-{uuid.uuid4().hex[:8].upper()}")
    name: str
    category: str  # "Cleaning", "Safety", "Tools", "Office"
    quantity: float
    unit: str
    reorder_threshold: float
    reorder_quantity: float
    supplier: Optional[str] = None
    cost_per_unit: float
    storage_location: str
    last_restocked: str

# ============================================================================
# IN-MEMORY STORAGE (Replace with database in production)
# ============================================================================

seeds_db: List[SeedInventory] = []
packaging_db: List[PackagingMaterial] = []
nutrients_db: List[NutrientSolution] = []
equipment_db: List[Equipment] = []
supplies_db: List[SupplyItem] = []

# ============================================================================
# DEMO DATA
# ============================================================================

def initialize_demo_data():
    """Initialize demo inventory data"""
    global seeds_db, packaging_db, nutrients_db, equipment_db, supplies_db
    
    # Demo Seeds
    seeds_db = [
        SeedInventory(
            variety="Buttercrunch Lettuce",
            category=SeedCategory.LEAFY_GREENS,
            supplier="Johnny's Seeds",
            lot_number="LC2024-1156",
            quantity_grams=500,
            germination_rate=92,
            purchase_date=(datetime.now() - timedelta(days=30)).isoformat(),
            expiration_date=(datetime.now() + timedelta(days=335)).isoformat(),
            cost_per_gram=0.15,
            storage_location="Seed Vault A - Shelf 2"
        ),
        SeedInventory(
            variety="Genovese Basil",
            category=SeedCategory.HERBS,
            supplier="High Mowing Seeds",
            lot_number="HB2024-0892",
            quantity_grams=250,
            germination_rate=88,
            purchase_date=(datetime.now() - timedelta(days=45)).isoformat(),
            expiration_date=(datetime.now() + timedelta(days=320)).isoformat(),
            cost_per_gram=0.22,
            storage_location="Seed Vault A - Shelf 3"
        ),
        SeedInventory(
            variety="Radish Microgreens",
            category=SeedCategory.MICROGREENS,
            supplier="True Leaf Market",
            lot_number="RM2024-3344",
            quantity_grams=1000,
            germination_rate=95,
            purchase_date=(datetime.now() - timedelta(days=15)).isoformat(),
            expiration_date=(datetime.now() + timedelta(days=350)).isoformat(),
            cost_per_gram=0.08,
            storage_location="Seed Vault B - Shelf 1"
        )
    ]
    
    # Demo Packaging
    packaging_db = [
        PackagingMaterial(
            type=PackagingType.CLAMSHELL,
            description="5oz Clear Clamshell",
            quantity=450,
            unit="each",
            reorder_point=200,
            reorder_quantity=1000,
            supplier="Eco-Products",
            cost_per_unit=0.35,
            storage_location="Packaging Room - Shelf A",
            last_restocked=(datetime.now() - timedelta(days=20)).isoformat()
        ),
        PackagingMaterial(
            type=PackagingType.BAG,
            description="1lb Produce Bags",
            quantity=180,
            unit="roll",
            reorder_point=100,
            reorder_quantity=500,
            supplier="Uline",
            cost_per_unit=0.12,
            storage_location="Packaging Room - Shelf B",
            last_restocked=(datetime.now() - timedelta(days=35)).isoformat()
        ),
        PackagingMaterial(
            type=PackagingType.LABEL,
            description="Product Labels - 2x3 inch",
            quantity=2500,
            unit="sheet",
            reorder_point=500,
            reorder_quantity=5000,
            supplier="OnlineLabels.com",
            cost_per_unit=0.05,
            storage_location="Packaging Room - Drawer 1",
            last_restocked=(datetime.now() - timedelta(days=10)).isoformat()
        )
    ]
    
    # Demo Nutrients
    nutrients_db = [
        NutrientSolution(
            type=NutrientType.BASE_A,
            brand="General Hydroponics - Flora Series",
            batch_number="FGM-2024-08-A",
            concentration="1:100",
            volume_ml=10000,
            volume_remaining_ml=6500,
            purchase_date=(datetime.now() - timedelta(days=60)).isoformat(),
            expiration_date=(datetime.now() + timedelta(days=670)).isoformat(),
            cost_per_ml=0.015,
            storage_location="Nutrient Storage - Cabinet A",
            msds_link="https://example.com/msds/flora-grow"
        ),
        NutrientSolution(
            type=NutrientType.BASE_B,
            brand="General Hydroponics - Flora Series",
            batch_number="FGM-2024-08-B",
            concentration="1:100",
            volume_ml=10000,
            volume_remaining_ml=6200,
            purchase_date=(datetime.now() - timedelta(days=60)).isoformat(),
            expiration_date=(datetime.now() + timedelta(days=670)).isoformat(),
            cost_per_ml=0.015,
            storage_location="Nutrient Storage - Cabinet A"
        ),
        NutrientSolution(
            type=NutrientType.CAL_MAG,
            brand="Botanicare - Cal-Mag Plus",
            batch_number="BCM-2024-09-X",
            concentration="2:1",
            volume_ml=4000,
            volume_remaining_ml=2800,
            purchase_date=(datetime.now() - timedelta(days=45)).isoformat(),
            expiration_date=(datetime.now() + timedelta(days=685)).isoformat(),
            cost_per_ml=0.022,
            storage_location="Nutrient Storage - Cabinet B"
        )
    ]
    
    # Demo Equipment
    equipment_db = [
        Equipment(
            name="HVAC System - Zone A",
            category="HVAC",
            model="Daikin VRV-IV",
            serial_number="DKN2024-A-00156",
            purchase_date="2024-01-15",
            warranty_expiration="2027-01-15",
            maintenance_interval_days=90,
            last_maintenance=(datetime.now() - timedelta(days=45)).isoformat(),
            next_maintenance=(datetime.now() + timedelta(days=45)).isoformat(),
            status=EquipmentStatus.OPERATIONAL,
            location="Zone A - Ceiling Mount",
            notes="Quarterly filter replacement required"
        ),
        Equipment(
            name="LED Grow Light - Rack 1",
            category="Lighting",
            model="Fluence SPYDR 2i",
            serial_number="FLC-SPYDR-2024-001",
            purchase_date="2024-03-10",
            warranty_expiration="2027-03-10",
            maintenance_interval_days=180,
            last_maintenance=(datetime.now() - timedelta(days=160)).isoformat(),
            next_maintenance=(datetime.now() + timedelta(days=20)).isoformat(),
            status=EquipmentStatus.MAINTENANCE_DUE,
            location="Zone A - Rack 1",
            notes="LED driver check and cleaning due soon"
        ),
        Equipment(
            name="Irrigation Pump #2",
            category="Irrigation",
            model="Grundfos CR15-3",
            serial_number="GRF-CR15-2024-B002",
            purchase_date="2024-02-20",
            warranty_expiration="2026-02-20",
            maintenance_interval_days=60,
            last_maintenance=(datetime.now() - timedelta(days=75)).isoformat(),
            next_maintenance=(datetime.now() - timedelta(days=15)).isoformat(),
            status=EquipmentStatus.MAINTENANCE_OVERDUE,
            location="Mechanical Room - Bay 2",
            notes="OVERDUE: Seal replacement and pressure test required"
        )
    ]
    
    # Demo Supplies
    supplies_db = [
        SupplyItem(
            name="Nitrile Gloves - Large",
            category="Safety",
            quantity=350,
            unit="pairs",
            reorder_threshold=100,
            reorder_quantity=500,
            supplier="Grainger",
            cost_per_unit=0.25,
            storage_location="Supply Closet - Shelf 1",
            last_restocked=(datetime.now() - timedelta(days=25)).isoformat()
        ),
        SupplyItem(
            name="pH Test Strips",
            category="Monitoring",
            quantity=45,
            unit="strips",
            reorder_threshold=20,
            reorder_quantity=100,
            supplier="Amazon Business",
            cost_per_unit=0.15,
            storage_location="Lab Supplies - Drawer 3",
            last_restocked=(datetime.now() - timedelta(days=40)).isoformat()
        ),
        SupplyItem(
            name="Sanitizing Solution",
            category="Cleaning",
            quantity=8,
            unit="gallons",
            reorder_threshold=5,
            reorder_quantity=20,
            supplier="Diversey",
            cost_per_unit=12.50,
            storage_location="Cleaning Supplies - Cabinet",
            last_restocked=(datetime.now() - timedelta(days=15)).isoformat()
        )
    ]

# Initialize demo data on module load
initialize_demo_data()

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def calculate_alert_level(current: float, threshold: float) -> AlertLevel:
    """Calculate alert level based on current quantity vs threshold"""
    if current <= 0:
        return AlertLevel.CRITICAL
    
    percentage = (current / threshold) * 100
    
    if percentage < 10:
        return AlertLevel.CRITICAL
    elif percentage < 25:
        return AlertLevel.WARNING
    elif percentage < 50:
        return AlertLevel.LOW
    else:
        return AlertLevel.NORMAL

def days_until_expiration(expiration_date: str) -> int:
    """Calculate days until expiration"""
    exp_date = datetime.fromisoformat(expiration_date)
    return (exp_date - datetime.now()).days

def days_until_maintenance(next_maintenance: str) -> int:
    """Calculate days until next maintenance"""
    maint_date = datetime.fromisoformat(next_maintenance)
    return (maint_date - datetime.now()).days

# ============================================================================
# SEED INVENTORY ENDPOINTS
# ============================================================================

@router.get("/seeds/list")
async def list_seeds():
    """Get all seed inventory with expiration warnings"""
    seeds_with_warnings = []
    
    for seed in seeds_db:
        days_to_exp = days_until_expiration(seed.expiration_date)
        
        warning = None
        if days_to_exp < 30:
            warning = "critical"
        elif days_to_exp < 90:
            warning = "warning"
        
        seeds_with_warnings.append({
            **seed.dict(),
            "days_to_expiration": days_to_exp,
            "expiration_warning": warning
        })
    
    return {
        "ok": True,
        "seeds": seeds_with_warnings,
        "total_count": len(seeds_db),
        "total_value": sum(s.quantity_grams * s.cost_per_gram for s in seeds_db)
    }

@router.post("/seeds/add")
async def add_seed(seed: SeedInventory):
    """Add new seed inventory"""
    seeds_db.append(seed)
    return {"ok": True, "seed": seed, "message": "Seed inventory added"}

@router.put("/seeds/update/{seed_id}")
async def update_seed(seed_id: str, updates: dict):
    """Update seed inventory"""
    for i, seed in enumerate(seeds_db):
        if seed.seed_id == seed_id:
            for key, value in updates.items():
                if hasattr(seed, key):
                    setattr(seed, key, value)
            return {"ok": True, "seed": seeds_db[i], "message": "Seed updated"}
    
    raise HTTPException(status_code=404, detail="Seed not found")

@router.get("/seeds/expiring")
async def get_expiring_seeds(days: int = 90):
    """Get seeds expiring within specified days"""
    expiring = []
    
    for seed in seeds_db:
        days_to_exp = days_until_expiration(seed.expiration_date)
        if 0 < days_to_exp <= days:
            expiring.append({
                **seed.dict(),
                "days_to_expiration": days_to_exp
            })
    
    expiring.sort(key=lambda x: x["days_to_expiration"])
    
    return {"ok": True, "expiring_seeds": expiring, "count": len(expiring)}

# ============================================================================
# PACKAGING INVENTORY ENDPOINTS
# ============================================================================

@router.get("/packaging/list")
async def list_packaging():
    """Get all packaging materials with stock alerts"""
    packaging_with_alerts = []
    
    for pkg in packaging_db:
        alert = calculate_alert_level(pkg.quantity, pkg.reorder_point)
        stock_percentage = (pkg.quantity / pkg.reorder_point) * 100
        
        packaging_with_alerts.append({
            **pkg.dict(),
            "alert_level": alert.value,
            "stock_percentage": round(stock_percentage, 1),
            "needs_reorder": pkg.quantity <= pkg.reorder_point
        })
    
    return {
        "ok": True,
        "packaging": packaging_with_alerts,
        "total_count": len(packaging_db),
        "reorder_needed": sum(1 for p in packaging_db if p.quantity <= p.reorder_point)
    }

@router.post("/packaging/add")
async def add_packaging(packaging: PackagingMaterial):
    """Add new packaging material"""
    packaging_db.append(packaging)
    return {"ok": True, "packaging": packaging, "message": "Packaging added"}

@router.post("/packaging/restock/{packaging_id}")
async def restock_packaging(packaging_id: str, quantity: int):
    """Restock packaging material"""
    for pkg in packaging_db:
        if pkg.packaging_id == packaging_id:
            pkg.quantity += quantity
            pkg.last_restocked = datetime.now().isoformat()
            return {"ok": True, "packaging": pkg, "message": f"Restocked {quantity} units"}
    
    raise HTTPException(status_code=404, detail="Packaging not found")

# ============================================================================
# NUTRIENT SOLUTION ENDPOINTS
# ============================================================================

@router.get("/nutrients/list")
async def list_nutrients():
    """Get all nutrient solutions with usage tracking"""
    nutrients_with_usage = []
    
    for nut in nutrients_db:
        usage_percentage = ((nut.volume_ml - nut.volume_remaining_ml) / nut.volume_ml) * 100
        days_to_exp = days_until_expiration(nut.expiration_date) if nut.expiration_date else None
        
        nutrients_with_usage.append({
            **nut.dict(),
            "usage_percentage": round(usage_percentage, 1),
            "remaining_percentage": round(100 - usage_percentage, 1),
            "days_to_expiration": days_to_exp,
            "needs_reorder": nut.volume_remaining_ml < (nut.volume_ml * 0.25)
        })
    
    return {
        "ok": True,
        "nutrients": nutrients_with_usage,
        "total_count": len(nutrients_db)
    }

@router.post("/nutrients/record-usage/{nutrient_id}")
async def record_nutrient_usage(nutrient_id: str, volume_used_ml: float):
    """Record nutrient solution usage"""
    for nut in nutrients_db:
        if nut.nutrient_id == nutrient_id:
            if nut.volume_remaining_ml >= volume_used_ml:
                nut.volume_remaining_ml -= volume_used_ml
                return {
                    "ok": True,
                    "nutrient": nut,
                    "volume_used": volume_used_ml,
                    "remaining_ml": nut.volume_remaining_ml
                }
            else:
                raise HTTPException(status_code=400, detail="Insufficient volume")
    
    raise HTTPException(status_code=404, detail="Nutrient not found")

# ============================================================================
# EQUIPMENT MANAGEMENT ENDPOINTS
# ============================================================================

@router.get("/equipment/list")
async def list_equipment():
    """Get all equipment with maintenance status"""
    equipment_with_status = []
    
    for eq in equipment_db:
        days_to_maint = days_until_maintenance(eq.next_maintenance)
        
        # Auto-update status based on maintenance schedule
        if days_to_maint < 0:
            eq.status = EquipmentStatus.MAINTENANCE_OVERDUE
        elif days_to_maint < 7:
            eq.status = EquipmentStatus.MAINTENANCE_DUE
        
        equipment_with_status.append({
            **eq.dict(),
            "days_to_maintenance": days_to_maint,
            "maintenance_overdue": days_to_maint < 0
        })
    
    return {
        "ok": True,
        "equipment": equipment_with_status,
        "total_count": len(equipment_db),
        "maintenance_overdue": sum(1 for e in equipment_with_status if e["maintenance_overdue"]),
        "maintenance_due": sum(1 for e in equipment_with_status if 0 <= e["days_to_maintenance"] < 7)
    }

@router.post("/equipment/log-maintenance/{equipment_id}")
async def log_maintenance(equipment_id: str, notes: str = ""):
    """Log equipment maintenance completion"""
    for eq in equipment_db:
        if eq.equipment_id == equipment_id:
            eq.last_maintenance = datetime.now().isoformat()
            next_maint = datetime.now() + timedelta(days=eq.maintenance_interval_days)
            eq.next_maintenance = next_maint.isoformat()
            eq.status = EquipmentStatus.OPERATIONAL
            if notes:
                eq.notes = notes
            return {"ok": True, "equipment": eq, "message": "Maintenance logged"}
    
    raise HTTPException(status_code=404, detail="Equipment not found")

# ============================================================================
# SUPPLY INVENTORY ENDPOINTS
# ============================================================================

@router.get("/supplies/list")
async def list_supplies():
    """Get all supplies with reorder alerts"""
    supplies_with_alerts = []
    
    for sup in supplies_db:
        alert = calculate_alert_level(sup.quantity, sup.reorder_threshold)
        
        supplies_with_alerts.append({
            **sup.dict(),
            "alert_level": alert.value,
            "needs_reorder": sup.quantity <= sup.reorder_threshold
        })
    
    return {
        "ok": True,
        "supplies": supplies_with_alerts,
        "total_count": len(supplies_db),
        "reorder_needed": sum(1 for s in supplies_db if s.quantity <= s.reorder_threshold)
    }

@router.post("/supplies/use/{supply_id}")
async def use_supply(supply_id: str, quantity_used: float):
    """Record supply usage"""
    for sup in supplies_db:
        if sup.supply_id == supply_id:
            if sup.quantity >= quantity_used:
                sup.quantity -= quantity_used
                return {"ok": True, "supply": sup, "quantity_used": quantity_used}
            else:
                raise HTTPException(status_code=400, detail="Insufficient quantity")
    
    raise HTTPException(status_code=404, detail="Supply not found")

# ============================================================================
# REORDER ALERTS ENDPOINT
# ============================================================================

@router.get("/reorder-alerts")
async def get_reorder_alerts():
    """Get all items requiring reorder"""
    alerts = []
    
    # Check packaging
    for pkg in packaging_db:
        if pkg.quantity <= pkg.reorder_point:
            alert_level = calculate_alert_level(pkg.quantity, pkg.reorder_point)
            alerts.append({
                "type": "packaging",
                "id": pkg.packaging_id,
                "name": pkg.description,
                "current_quantity": pkg.quantity,
                "reorder_point": pkg.reorder_point,
                "recommended_order": pkg.reorder_quantity,
                "alert_level": alert_level.value,
                "supplier": pkg.supplier
            })
    
    # Check supplies
    for sup in supplies_db:
        if sup.quantity <= sup.reorder_threshold:
            alert_level = calculate_alert_level(sup.quantity, sup.reorder_threshold)
            alerts.append({
                "type": "supply",
                "id": sup.supply_id,
                "name": sup.name,
                "current_quantity": sup.quantity,
                "reorder_point": sup.reorder_threshold,
                "recommended_order": sup.reorder_quantity,
                "alert_level": alert_level.value,
                "supplier": sup.supplier or "N/A"
            })
    
    # Check nutrients (low stock)
    for nut in nutrients_db:
        if nut.volume_remaining_ml < (nut.volume_ml * 0.25):
            alerts.append({
                "type": "nutrient",
                "id": nut.nutrient_id,
                "name": f"{nut.brand} - {nut.type.value}",
                "current_quantity": nut.volume_remaining_ml,
                "reorder_point": nut.volume_ml * 0.25,
                "recommended_order": nut.volume_ml,
                "alert_level": "warning",
                "supplier": nut.brand
            })
    
    # Sort by alert level (critical first)
    alert_priority = {"critical": 0, "warning": 1, "low": 2, "normal": 3}
    alerts.sort(key=lambda x: alert_priority.get(x["alert_level"], 3))
    
    return {
        "ok": True,
        "alerts": alerts,
        "total_alerts": len(alerts),
        "critical": sum(1 for a in alerts if a["alert_level"] == "critical"),
        "warning": sum(1 for a in alerts if a["alert_level"] == "warning")
    }

# ============================================================================
# DASHBOARD ENDPOINT
# ============================================================================

@router.get("/dashboard")
async def get_inventory_dashboard():
    """Get comprehensive inventory dashboard data"""
    
    # Expiring seeds
    expiring_seeds = []
    for seed in seeds_db:
        days_to_exp = days_until_expiration(seed.expiration_date)
        if 0 < days_to_exp <= 90:
            expiring_seeds.append({
                "variety": seed.variety,
                "days_to_expiration": days_to_exp,
                "quantity_grams": seed.quantity_grams
            })
    
    # Reorder counts
    packaging_reorder = sum(1 for p in packaging_db if p.quantity <= p.reorder_point)
    supplies_reorder = sum(1 for s in supplies_db if s.quantity <= s.reorder_threshold)
    
    # Maintenance status
    equipment_overdue = sum(1 for e in equipment_db if days_until_maintenance(e.next_maintenance) < 0)
    equipment_due = sum(1 for e in equipment_db if 0 <= days_until_maintenance(e.next_maintenance) < 7)
    
    # Nutrient levels
    nutrient_levels = []
    for nut in nutrients_db:
        nutrient_levels.append({
            "type": nut.type.value,
            "remaining_percentage": round((nut.volume_remaining_ml / nut.volume_ml) * 100, 1)
        })
    
    return {
        "ok": True,
        "summary": {
            "total_seed_varieties": len(seeds_db),
            "expiring_seeds_count": len(expiring_seeds),
            "packaging_types": len(packaging_db),
            "packaging_reorder_needed": packaging_reorder,
            "nutrient_solutions": len(nutrients_db),
            "equipment_count": len(equipment_db),
            "equipment_maintenance_overdue": equipment_overdue,
            "equipment_maintenance_due": equipment_due,
            "supplies_count": len(supplies_db),
            "supplies_reorder_needed": supplies_reorder
        },
        "expiring_seeds": expiring_seeds[:10],  # Top 10
        "nutrient_levels": nutrient_levels,
        "total_inventory_value": {
            "seeds": round(sum(s.quantity_grams * s.cost_per_gram for s in seeds_db), 2),
            "packaging": round(sum(p.quantity * p.cost_per_unit for p in packaging_db), 2),
            "nutrients": round(sum(n.volume_remaining_ml * n.cost_per_ml for n in nutrients_db), 2),
            "supplies": round(sum(s.quantity * s.cost_per_unit for s in supplies_db), 2)
        }
    }
