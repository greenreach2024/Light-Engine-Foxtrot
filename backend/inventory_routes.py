"""Inventory + forecasting API routes for tray lifecycle management."""

from datetime import date, datetime, timedelta, timezone
from typing import Dict, Any, Optional, List
import requests

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .models.base import get_db, Base, engine
from .models.inventory import (
    Tray,
    TrayFormat,
    TrayRun,
    TrayPlacement,
    Location,
    Group,
    Zone,
    Room,
    Farm,
    ScanEvent,
)
from .state import PlanStore

router = APIRouter(prefix="/api", tags=["inventory"])

# Ensure tables exist for inventory models
Base.metadata.create_all(bind=engine)


# Helpers

def _compute_expected_harvest(recipe_id: str, seed_date: date, plan_store: Optional[PlanStore]) -> date:
    days_to_harvest = 21  # sensible default
    if plan_store is not None:
        recipe = plan_store.get(recipe_id)
        if isinstance(recipe, dict):
            if isinstance(recipe.get("daysToHarvest"), (int, float)):
                days_to_harvest = int(recipe["daysToHarvest"])
            else:
                schedule = recipe.get("schedule") or recipe.get("stages")
                if isinstance(schedule, dict):
                    stages = schedule.get("stages", [])
                else:
                    stages = schedule or []
                total_days = 0
                for stage in stages:
                    if isinstance(stage, dict):
                        if isinstance(stage.get("days"), (int, float)):
                            total_days += int(stage["days"])
                        elif isinstance(stage.get("durationDays"), (int, float)):
                            total_days += int(stage["durationDays"])
                if total_days > 0:
                    days_to_harvest = total_days
    return seed_date + timedelta(days=days_to_harvest)


def _get_plan_store(request: Request) -> Optional[PlanStore]:
    plan_store = getattr(request.app.state, "PLAN_STORE", None)
    return plan_store


# Schemas
class TrayFormatRequest(BaseModel):
    name: str
    plantSiteCount: int
    systemType: Optional[str] = None
    trayMaterial: Optional[str] = None
    description: Optional[str] = None
    targetWeightPerSite: Optional[float] = None
    weightUnit: Optional[str] = "oz"
    isWeightBased: bool = False


class TrayRegistrationRequest(BaseModel):
    qrCodeValue: str
    trayFormatId: str


class LocationRegistrationRequest(BaseModel):
    qrCodeValue: str
    groupId: str
    name: Optional[str] = None


class SeedTrayRequest(BaseModel):
    recipeId: str
    seedDate: date
    plantedSiteCount: Optional[int] = None


class PlacementRequest(BaseModel):
    locationId: str
    placedAt: Optional[datetime] = None
    note: Optional[str] = None


class HarvestRequest(BaseModel):
    harvestedAt: Optional[datetime] = None
    actualHarvestCount: Optional[int] = None
    note: Optional[str] = None
    lot_code: Optional[str] = None
    actualWeight: Optional[float] = None
    weightUnit: Optional[str] = None


class UpdateTargetWeightRequest(BaseModel):
    targetWeightPerSite: float


# Endpoints
@router.post("/tray-formats")
def create_tray_format(payload: TrayFormatRequest, db: Session = Depends(get_db)):
    tray_format = TrayFormat(
        name=payload.name,
        plant_site_count=payload.plantSiteCount,
        system_type=payload.systemType,
        tray_material=payload.trayMaterial,
        description=payload.description,
        target_weight_per_site=payload.targetWeightPerSite,
        weight_unit=payload.weightUnit,
        is_weight_based=payload.isWeightBased,
        is_custom=True,  # User-created formats are custom
        is_approved=False  # Requires GreenReach approval
    )
    db.add(tray_format)
    db.commit()
    db.refresh(tray_format)
    return {
        "trayFormatId": str(tray_format.tray_format_id),
        "name": tray_format.name,
        "plantSiteCount": tray_format.plant_site_count,
        "systemType": tray_format.system_type,
        "isWeightBased": tray_format.is_weight_based,
        "isCustom": tray_format.is_custom,
    }


@router.get("/tray-formats")
def list_tray_formats(db: Session = Depends(get_db)):
    formats = db.query(TrayFormat).all()
    return [
        {
            "trayFormatId": str(fmt.tray_format_id),
            "name": fmt.name,
            "plantSiteCount": fmt.plant_site_count,
            "systemType": fmt.system_type,
            "trayMaterial": fmt.tray_material,
            "description": fmt.description,
            "targetWeightPerSite": fmt.target_weight_per_site,
            "weightUnit": fmt.weight_unit,
            "isWeightBased": fmt.is_weight_based,
            "isCustom": fmt.is_custom,
            "isApproved": fmt.is_approved,
        }
        for fmt in formats
    ]


@router.put("/tray-formats/{tray_format_id}")
def update_tray_format(tray_format_id: str, payload: TrayFormatRequest, db: Session = Depends(get_db)):
    tray_format = db.query(TrayFormat).filter_by(tray_format_id=tray_format_id).first()
    if not tray_format:
        raise HTTPException(status_code=404, detail="Tray format not found")
    
    tray_format.name = payload.name
    tray_format.plant_site_count = payload.plantSiteCount
    tray_format.system_type = payload.systemType
    tray_format.tray_material = payload.trayMaterial
    tray_format.description = payload.description
    tray_format.target_weight_per_site = payload.targetWeightPerSite
    tray_format.weight_unit = payload.weightUnit
    tray_format.is_weight_based = payload.isWeightBased
    
    db.commit()
    return {"ok": True, "message": "Format updated"}


@router.delete("/tray-formats/{tray_format_id}")
def delete_tray_format(tray_format_id: str, db: Session = Depends(get_db)):
    tray_format = db.query(TrayFormat).filter_by(tray_format_id=tray_format_id).first()
    if not tray_format:
        raise HTTPException(status_code=404, detail="Tray format not found")
    
    # Check if any trays use this format
    tray_count = db.query(Tray).filter_by(tray_format_id=tray_format_id).count()
    if tray_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {tray_count} trays use this format")
    
    db.delete(tray_format)
    db.commit()
    return {"ok": True, "message": "Format deleted"}


@router.post("/tray-formats/{tray_format_id}/update-target")
def update_target_weight(tray_format_id: str, payload: UpdateTargetWeightRequest, db: Session = Depends(get_db)):
    """Update target weight per site based on actual harvest data"""
    tray_format = db.query(TrayFormat).filter_by(tray_format_id=tray_format_id).first()
    if not tray_format:
        raise HTTPException(status_code=404, detail="Tray format not found")
    
    if not tray_format.is_weight_based:
        raise HTTPException(status_code=400, detail="Format is not weight-based")
    
    tray_format.target_weight_per_site = payload.targetWeightPerSite
    db.commit()
    
    return {
        "ok": True,
        "message": "Target weight updated",
        "newTargetPerSite": tray_format.target_weight_per_site,
        "weightUnit": tray_format.weight_unit
    }


@router.post("/trays/register")
def register_tray(payload: TrayRegistrationRequest, db: Session = Depends(get_db)):
    tray_format = db.query(TrayFormat).filter_by(tray_format_id=payload.trayFormatId).first()
    if not tray_format:
        raise HTTPException(status_code=404, detail="Tray format not found")

    tray = db.query(Tray).filter_by(qr_code_value=payload.qrCodeValue).first()
    if tray:
        return {
            "trayId": str(tray.tray_id),
            "qrCodeValue": tray.qr_code_value,
            "trayFormatId": str(tray.tray_format_id),
        }

    tray = Tray(qr_code_value=payload.qrCodeValue, tray_format_id=str(tray_format.tray_format_id))
    db.add(tray)
    db.commit()
    db.refresh(tray)
    db.add(
        ScanEvent(
            type="TRAY_SCAN",
            raw_value=payload.qrCodeValue,
            tray_id=str(tray.tray_id),
        )
    )
    db.commit()
    return {
        "trayId": str(tray.tray_id),
        "qrCodeValue": tray.qr_code_value,
        "trayFormatId": str(tray.tray_format_id),
    }


@router.put("/trays/{tray_id}")
def update_tray(tray_id: str, payload: dict, db: Session = Depends(get_db)):
    """Update tray properties like format assignment"""
    tray = db.query(Tray).filter_by(tray_id=tray_id).first()
    if not tray:
        raise HTTPException(status_code=404, detail="Tray not found")
    
    if "trayFormatId" in payload:
        tray_format = db.query(TrayFormat).filter_by(tray_format_id=payload["trayFormatId"]).first()
        if not tray_format:
            raise HTTPException(status_code=404, detail="Tray format not found")
        tray.tray_format_id = str(tray_format.tray_format_id)
    
    db.commit()
    db.refresh(tray)
    
    return {
        "trayId": str(tray.tray_id),
        "qrCodeValue": tray.qr_code_value,
        "trayFormatId": str(tray.tray_format_id),
    }


@router.post("/locations/register")
def register_location(payload: LocationRegistrationRequest, db: Session = Depends(get_db)):
    group = db.query(Group).filter_by(group_id=payload.groupId).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    existing = db.query(Location).filter_by(qr_code_value=payload.qrCodeValue).first()
    if existing:
        return {
            "locationId": str(existing.location_id),
            "qrCodeValue": existing.qr_code_value,
            "groupId": str(existing.group_id),
            "name": existing.name,
        }

    location = Location(qr_code_value=payload.qrCodeValue, group_id=str(group.group_id), name=payload.name)
    db.add(location)
    db.commit()
    db.refresh(location)
    db.add(
        ScanEvent(
            type="LOCATION_SCAN",
            raw_value=payload.qrCodeValue,
            location_id=str(location.location_id),
        )
    )
    db.commit()
    return {
        "locationId": str(location.location_id),
        "qrCodeValue": location.qr_code_value,
        "groupId": str(location.group_id),
        "name": location.name,
    }


@router.post("/farms")
def create_farm(payload: Dict[str, str], db: Session = Depends(get_db)):
    name = payload.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    farm = Farm(name=name)
    db.add(farm)
    db.commit()
    db.refresh(farm)
    return {"farmId": str(farm.farm_id), "name": farm.name}


@router.post("/rooms")
def create_room(payload: Dict[str, str], db: Session = Depends(get_db)):
    name = payload.get("name")
    farm_id = payload.get("farmId")
    if not name or not farm_id:
        raise HTTPException(status_code=400, detail="farmId and name are required")
    farm = db.query(Farm).filter_by(farm_id=farm_id).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")
    room = Room(name=name, farm_id=farm_id)
    db.add(room)
    db.commit()
    db.refresh(room)
    return {"roomId": str(room.room_id), "name": room.name, "farmId": str(room.farm_id)}


@router.post("/zones")
def create_zone(payload: Dict[str, str], db: Session = Depends(get_db)):
    name = payload.get("name")
    room_id = payload.get("roomId")
    if not name or not room_id:
        raise HTTPException(status_code=400, detail="roomId and name are required")
    room = db.query(Room).filter_by(room_id=room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    zone = Zone(name=name, room_id=room_id)
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return {"zoneId": str(zone.zone_id), "name": zone.name, "roomId": str(zone.room_id)}


@router.post("/groups")
def create_group(payload: Dict[str, str], db: Session = Depends(get_db)):
    name = payload.get("name")
    zone_id = payload.get("zoneId")
    if not name or not zone_id:
        raise HTTPException(status_code=400, detail="zoneId and name are required")
    zone = db.query(Zone).filter_by(zone_id=zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    group = Group(name=name, zone_id=zone_id)
    db.add(group)
    db.commit()
    db.refresh(group)
    return {"groupId": str(group.group_id), "name": group.name, "zoneId": str(group.zone_id)}


@router.post("/trays/{tray_id}/seed")
def seed_tray(
    tray_id: str,
    payload: SeedTrayRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    tray = db.query(Tray).filter_by(tray_id=tray_id).first()
    if not tray:
        raise HTTPException(status_code=404, detail="Tray not found")

    active_run = (
        db.query(TrayRun)
        .filter(TrayRun.tray_id == tray_id, TrayRun.status.in_(["SEEDED", "GERMINATING", "IN_GROW"]))
        .first()
    )
    if active_run:
        raise HTTPException(status_code=400, detail="Tray already has an active run")

    planted_count = payload.plantedSiteCount or tray.tray_format.plant_site_count
    expected_date = _compute_expected_harvest(payload.recipeId, payload.seedDate, _get_plan_store(request))

    tray_run = TrayRun(
        tray_id=tray_id,
        recipe_id=payload.recipeId,
        seed_date=payload.seedDate,
        planted_site_count=planted_count,
        status="SEEDED",
        expected_harvest_date=expected_date,
    )
    db.add(tray_run)
    db.add(
        ScanEvent(
            type="RECIPE_SELECT",
            raw_value=payload.recipeId,
            tray_id=tray_id,
        )
    )
    db.commit()
    db.refresh(tray_run)
    
    # Track inventory usage for seeds and grow media
    try:
        requests.post(
            "http://localhost:8000/api/inventory/usage/tray-seeding",
            json={
                "tray_id": str(tray_id),
                "tray_format": tray.tray_format.format_name,
                "plant_site_count": planted_count,
                "crop_variety": payload.recipeId,  # Using recipe_id as crop identifier
                "seed_date": payload.seedDate.isoformat()
            },
            timeout=5.0
        )
    except Exception as e:
        print(f"Warning: Failed to track tray seeding usage: {e}")
    
    return {
        "trayRunId": str(tray_run.tray_run_id),
        "trayId": str(tray_id),
        "recipeId": tray_run.recipe_id,
        "seedDate": tray_run.seed_date.isoformat(),
        "plantedSiteCount": tray_run.planted_site_count,
        "expectedHarvestDate": tray_run.expected_harvest_date.isoformat(),
        "status": tray_run.status,
    }


@router.post("/tray-runs/{tray_run_id}/place")
def place_tray(tray_run_id: str, payload: PlacementRequest, db: Session = Depends(get_db)):
    tray_run = db.query(TrayRun).filter_by(tray_run_id=tray_run_id).first()
    if not tray_run:
        raise HTTPException(status_code=404, detail="Tray run not found")

    location = db.query(Location).filter_by(location_id=payload.locationId).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    now = payload.placedAt or datetime.utcnow()

    active_placement = (
        db.query(TrayPlacement)
        .filter(TrayPlacement.tray_run_id == tray_run_id, TrayPlacement.removed_at.is_(None))
        .first()
    )
    if active_placement:
        active_placement.removed_at = now

    placement = TrayPlacement(
        tray_run_id=tray_run_id,
        location_id=payload.locationId,
        placed_at=now,
        note=payload.note,
    )
    tray_run.status = "IN_GROW"
    db.add(placement)
    db.commit()
    db.refresh(placement)
    return {
        "placementId": str(placement.placement_id),
        "trayRunId": str(tray_run_id),
        "locationId": str(payload.locationId),
        "placedAt": placement.placed_at.isoformat(),
        "removedAt": placement.removed_at.isoformat() if placement.removed_at else None,
        "status": tray_run.status,
    }


@router.post("/tray-runs/{tray_run_id}/harvest")
def harvest_tray(tray_run_id: str, payload: HarvestRequest, db: Session = Depends(get_db)):
    tray_run = db.query(TrayRun).filter_by(tray_run_id=tray_run_id).first()
    if not tray_run:
        raise HTTPException(status_code=404, detail="Tray run not found")

    tray_run.status = "HARVESTED"
    harvested_at = payload.harvestedAt or datetime.utcnow()
    
    # Generate lot code if not provided (format: LOT-YYYY-MM-DD-HHMMSS)
    if not payload.lot_code:
        lot_code = f"LOT-{harvested_at.strftime('%Y-%m-%d-%H%M%S')}"
        tray_run.lot_code = lot_code
    else:
        lot_code = payload.lot_code
        tray_run.lot_code = lot_code
    
    # Store actual weight if provided
    if payload.actualWeight is not None:
        tray_run.actual_weight = payload.actualWeight
        tray_run.weight_unit = payload.weightUnit

    active_placement = (
        db.query(TrayPlacement)
        .filter(TrayPlacement.tray_run_id == tray_run_id, TrayPlacement.removed_at.is_(None))
        .first()
    )
    if active_placement:
        active_placement.removed_at = harvested_at

    db.add(
        ScanEvent(
            type="HARVEST_CONFIRM",
            raw_value=tray_run.recipe_id,
            tray_run_id=tray_run_id,
        )
    )
    db.commit()
    
    # Auto-create traceability batch (imported at top: from backend.batch_traceability import db as batch_db)
    try:
        from backend.batch_traceability import db as batch_db, BatchStatus, EventType
        import uuid
        
        # Create batch
        batch_id = f"BATCH-{harvested_at.strftime('%Y%m%d-%H%M%S')}"
        batch_db.batches[batch_id] = {
            "batch_id": batch_id,
            "crop_name": tray_run.recipe_id or "Unknown Crop",
            "variety": "",
            "seed_source": "Tray System",
            "quantity": int(payload.actualWeight) if payload.actualWeight else 0,
            "location": active_placement.location_id if active_placement else "Unknown",
            "status": BatchStatus.HARVESTED,
            "created_date": harvested_at.isoformat(),
            "expected_harvest_date": harvested_at.isoformat(),
            "notes": f"Auto-created from harvest scan (Tray: {tray_run_id})",
            "lot_code": lot_code,
            "tray_run_id": tray_run_id
        }
        
        # Create harvest event
        event_id = str(uuid.uuid4())
        batch_db.events[event_id] = {
            "event_id": event_id,
            "batch_id": batch_id,
            "event_type": EventType.HARVEST,
            "timestamp": harvested_at.isoformat(),
            "location": active_placement.location_id if active_placement else "Unknown",
            "quantity": int(payload.actualWeight) if payload.actualWeight else 0,
            "operator": "Worker",
            "notes": f"Harvested from tray {tray_run_id}"
        }
    except Exception as e:
        print(f"[Harvest] Failed to create traceability batch: {e}")
    
    return {
        "trayRunId": str(tray_run_id),
        "status": tray_run.status,
        "harvestedAt": harvested_at.isoformat(),
        "lotCode": lot_code,
        "batchId": batch_id if 'batch_id' in locals() else None,
        "printLabelUrl": f"/api/labels/harvest?lot_code={lot_code}"
    }


@router.get("/trays")
def get_tray_by_qr(qr_code: str, db: Session = Depends(get_db)):
    """Get tray by QR code with active run and placement."""
    tray = db.query(Tray).filter_by(qr_code_value=qr_code).first()
    if not tray:
        return []
    
    # Get active tray run
    active_run = db.query(TrayRun).filter(
        TrayRun.tray_id == str(tray.tray_id),
        TrayRun.status.in_(["SEEDED", "IN_GROW"])
    ).first()
    
    result = {
        "trayId": str(tray.tray_id),
        "qrCodeValue": tray.qr_code_value,
        "trayFormatId": str(tray.tray_format_id)
    }
    
    if active_run:
        result["trayRunId"] = str(active_run.tray_run_id)
        result["recipeId"] = active_run.recipe_id
        result["seedDate"] = active_run.seed_date.isoformat()
        result["expectedHarvestDate"] = active_run.expected_harvest_date.isoformat()
        result["plantedSiteCount"] = active_run.planted_site_count
        result["status"] = active_run.status
        
        # Get active placement with location info
        active_placement = db.query(TrayPlacement).filter(
            TrayPlacement.tray_run_id == str(active_run.tray_run_id),
            TrayPlacement.removed_at.is_(None)
        ).first()
        
        if active_placement:
            location = db.query(Location).filter_by(location_id=str(active_placement.location_id)).first()
            if location:
                result["placement"] = {
                    "locationId": str(location.location_id),
                    "locationQr": location.qr_code_value,
                    "locationName": location.name,
                    "groupId": location.group_id,
                    "placedAt": active_placement.placed_at.isoformat()
                }
    
    return [result]


@router.get("/recipes")
def list_recipes(request: Request):
    """
    Load recipes from lighting-recipes.json (production recipes).
    Falls back to plan_store if available (for lighting control integration).
    """
    import json
    from pathlib import Path
    
    recipes = []
    
    # Load from production lighting-recipes.json
    recipes_file = Path(__file__).parent.parent / "public" / "data" / "lighting-recipes.json"
    if recipes_file.exists():
        try:
            with open(recipes_file, 'r') as f:
                data = json.load(f)
                crops = data.get("crops", {})
                for crop_name, recipe_days in crops.items():
                    # Calculate days to harvest from recipe (max day)
                    days_to_harvest = max([day.get("day", 1) for day in recipe_days]) if recipe_days else 21
                    recipes.append({
                        "id": crop_name.lower().replace(" ", "-"),
                        "name": crop_name,
                        "daysToHarvest": days_to_harvest,
                        "crop": crop_name,
                        "variety": None
                    })
                return recipes
        except Exception as e:
            print(f"Error loading recipes from file: {e}")
    
    # Fallback to plan_store if file doesn't exist
    plan_store = _get_plan_store(request)
    if plan_store is not None:
        for key, payload in plan_store.list().items():
            name = payload.get("name") if isinstance(payload, dict) else None
            recipes.append({"id": key, "name": name or key})
    
    return recipes


def _active_tray_runs_query(db: Session):
    return db.query(TrayRun).filter(~TrayRun.status.in_(["HARVESTED", "DISCARDED"]))


@router.get("/inventory/current")
def current_inventory(farmId: str = Query(...), db: Session = Depends(get_db)):
    farm = db.query(Farm).filter_by(farm_id=farmId).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")

    response: Dict[str, Any] = {"farmId": farmId, "name": farm.name, "totals": {"trays": 0}, "rooms": []}

    rooms = db.query(Room).filter_by(farm_id=farmId).all()
    for room in rooms:
        room_entry = {"roomId": str(room.room_id), "name": room.name, "totals": {"trays": 0}, "zones": []}
        zones = db.query(Zone).filter_by(room_id=room.room_id).all()
        for zone in zones:
            zone_entry = {"zoneId": str(zone.zone_id), "name": zone.name, "totals": {"trays": 0}, "groups": []}
            groups = db.query(Group).filter_by(zone_id=zone.zone_id).all()
            for group in groups:
                locations = db.query(Location).filter_by(group_id=group.group_id).all()
                active_runs = (
                    _active_tray_runs_query(db)
                    .join(TrayPlacement)
                    .filter(TrayPlacement.location_id.in_([loc.location_id for loc in locations]), TrayPlacement.removed_at.is_(None))
                    .all()
                )
                group_entry = {
                    "groupId": str(group.group_id),
                    "name": group.name,
                    "totals": {"trays": len(active_runs)},
                }
                zone_entry["totals"]["trays"] += len(active_runs)
                zone_entry["groups"].append(group_entry)
            room_entry["totals"]["trays"] += zone_entry["totals"]["trays"]
            room_entry["zones"].append(zone_entry)
        response["totals"]["trays"] += room_entry["totals"]["trays"]
        response["rooms"].append(room_entry)
    return response


@router.get("/inventory/forecast")
def inventory_forecast(
    farmId: str = Query(...),
    days: int = Query(30, ge=1, le=180),
    db: Session = Depends(get_db),
):
    farm = db.query(Farm).filter_by(farm_id=farmId).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")

    end_date = date.today() + timedelta(days=days)
    runs = (
        _active_tray_runs_query(db)
        .join(TrayPlacement, TrayRun.tray_run_id == TrayPlacement.tray_run_id)
        .join(Location)
        .join(Group)
        .join(Zone)
        .join(Room)
        .filter(Room.farm_id == farmId, TrayRun.expected_harvest_date <= end_date)
        .all()
    )
    buckets: Dict[str, Dict[str, Any]] = {}
    for run in runs:
        key = run.expected_harvest_date.isoformat()
        bucket = buckets.setdefault(key, {"date": key, "total": 0, "byRecipe": {}})
        bucket["total"] += run.planted_site_count
        bucket["byRecipe"][run.recipe_id] = bucket["byRecipe"].get(run.recipe_id, 0) + run.planted_site_count

    ordered = [buckets[k] for k in sorted(buckets.keys())]
    return {"farmId": farmId, "forecast": ordered}


@router.get("/inventory/drilldown")
def inventory_drilldown(
    farmId: str = Query(...),
    groupId: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    farm = db.query(Farm).filter_by(farm_id=farmId).first()
    if not farm:
        raise HTTPException(status_code=404, detail="Farm not found")

    query = _active_tray_runs_query(db).join(TrayPlacement).join(Location).join(Group).join(Zone).join(Room)
    query = query.filter(Room.farm_id == farmId, TrayPlacement.removed_at.is_(None))
    if groupId:
        query = query.filter(Group.group_id == groupId)

    runs = query.all()
    items: List[Dict[str, Any]] = []
    for run in runs:
        active_placement = next((p for p in run.placements if p.removed_at is None), None)
        items.append(
            {
                "trayRunId": str(run.tray_run_id),
                "trayId": str(run.tray_id),
                "recipeId": run.recipe_id,
                "seedDate": run.seed_date.isoformat(),
                "expectedHarvestDate": run.expected_harvest_date.isoformat(),
                "status": run.status,
                "locationId": str(active_placement.location_id) if active_placement else None,
            }
        )
    return {"farmId": farmId, "trayRuns": items}


@router.get("/integration/inventory/snapshot")
def integration_snapshot(
    request: Request,
    farmId: str = Query(...),
    days: int = Query(30, ge=1, le=180),
    db: Session = Depends(get_db),
):
    api_token = request.headers.get("X-Api-Token")
    expected_token = request.app.state.__dict__.get("INTEGRATION_TOKEN") or None
    if expected_token and api_token != expected_token:
        raise HTTPException(status_code=401, detail="Invalid integration token")

    current = current_inventory(farmId=farmId, db=db)
    forecast = inventory_forecast(farmId=farmId, days=days, db=db)
    return {
        "farmId": farmId,
        "timestamp": datetime.utcnow().isoformat(),
        "current": current,
        "forecast": forecast,
    }


@router.get("/inventory/summary")
def inventory_summary(db: Session = Depends(get_db)):
    """Get inventory summary statistics for mobile app dashboard"""
    # Count active trays across all farms
    active_trays = db.query(TrayRun).filter(
        TrayRun.status.in_(['placed', 'growing', 'seeded'])
    ).count()
    
    # Sum total plants from active tray runs
    total_plants = db.query(func.sum(TrayRun.planted_site_count)).filter(
        TrayRun.status.in_(['placed', 'growing'])
    ).scalar() or 0
    
    # Count farms
    farms = db.query(Farm).count()
    
    return {
        "active_trays": active_trays,
        "total_plants": int(total_plants),
        "farms": farms if farms > 0 else 1,
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@router.get("/inventory/harvest-forecast")
def harvest_forecast_buckets(db: Session = Depends(get_db)):
    """Get harvest forecast buckets for mobile app dashboard"""
    today = date.today()
    
    # Today
    today_count = db.query(TrayRun).filter(
        TrayRun.expected_harvest_date == today,
        TrayRun.status.in_(['placed', 'growing'])
    ).count()
    
    # This week (next 7 days)
    this_week_count = db.query(TrayRun).filter(
        TrayRun.expected_harvest_date.between(today + timedelta(days=1), today + timedelta(days=7)),
        TrayRun.status.in_(['placed', 'growing'])
    ).count()
    
    # Next week (8-14 days)
    next_week_count = db.query(TrayRun).filter(
        TrayRun.expected_harvest_date.between(today + timedelta(days=8), today + timedelta(days=14)),
        TrayRun.status.in_(['placed', 'growing'])
    ).count()
    
    # Later (15+ days)
    later_count = db.query(TrayRun).filter(
        TrayRun.expected_harvest_date > today + timedelta(days=14),
        TrayRun.status.in_(['placed', 'growing'])
    ).count()
    
    return {
        "today": today_count,
        "this_week": this_week_count,
        "next_week": next_week_count,
        "later": later_count,
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


__all__ = ["router"]
