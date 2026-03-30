"""
Batch Traceability System - Seed-to-Sale Tracking
Complete lifecycle tracking from seed → harvest → sale
"""

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid

router = APIRouter()

# ============================================================================
# MODELS
# ============================================================================

class BatchStatus(str, Enum):
    """Batch lifecycle stages"""
    SEEDED = "seeded"
    GERMINATING = "germinating"
    TRANSPLANTED = "transplanted"
    GROWING = "growing"
    READY_HARVEST = "ready_harvest"
    HARVESTED = "harvested"
    PACKED = "packed"
    SOLD = "sold"
    DISPOSED = "disposed"

class EventType(str, Enum):
    """Lifecycle event types"""
    SEED = "seed"
    GERMINATE = "germinate"
    TRANSPLANT = "transplant"
    TREATMENT = "treatment"
    INSPECTION = "inspection"
    HARVEST = "harvest"
    PACK = "pack"
    SALE = "sale"
    DISPOSE = "dispose"
    NOTE = "note"

class CreateBatch(BaseModel):
    """Create new batch"""
    crop_name: str
    variety: Optional[str] = None
    seed_source: str  # Supplier/lot number
    quantity: int  # Number of seeds/plants
    location: str  # Zone/shelf/tray
    expected_harvest_date: Optional[str] = None
    notes: Optional[str] = None

class BatchEvent(BaseModel):
    """Record lifecycle event"""
    batch_id: str
    event_type: EventType
    timestamp: Optional[str] = None
    location: Optional[str] = None
    quantity: Optional[int] = None  # For harvest/sales
    operator: Optional[str] = None
    notes: Optional[str] = None
    photo_url: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class LinkSale(BaseModel):
    """Link batch to sale"""
    batch_id: str
    order_id: str
    quantity_sold: float
    unit: str
    price_per_unit: float
    buyer_name: str
    sale_date: str

# ============================================================================
# DATABASE (PLACEHOLDER - Replace with actual DB)
# ============================================================================

class BatchDatabase:
    """In-memory database placeholder"""
    
    def __init__(self):
        self.batches = {}
        self.events = {}
        self.sales_links = {}
        self._init_demo_data()
    
    def _init_demo_data(self):
        """Initialize with demo data - controlled by demo_config.py"""
        from .demo_config import should_use_demo_data
        if not should_use_demo_data("batch_traceability"):
            return  # Skip demo data in production
            
        demo_batch_id = "BATCH-2024-001"
        
        self.batches[demo_batch_id] = {
            "batch_id": demo_batch_id,
            "crop_name": "Buttercrunch Lettuce",
            "variety": "Buttercrunch",
            "seed_source": "Johnny's Selected Seeds - Lot #JS2024-001",
            "quantity": 200,
            "location": "Zone A - Shelf 2 - Trays 1-4",
            "status": BatchStatus.GROWING,
            "created_date": "2024-12-01T10:00:00",
            "expected_harvest_date": "2024-12-28",
            "notes": "Premium organic seeds for holiday sales"
        }
        
        # Demo events
        events = [
            {
                "event_id": str(uuid.uuid4()),
                "batch_id": demo_batch_id,
                "event_type": EventType.SEED,
                "timestamp": "2024-12-01T10:00:00",
                "location": "Germination Chamber",
                "quantity": 200,
                "operator": "Sarah Johnson",
                "notes": "Seeded 200 cells with organic buttercrunch"
            },
            {
                "event_id": str(uuid.uuid4()),
                "batch_id": demo_batch_id,
                "event_type": EventType.GERMINATE,
                "timestamp": "2024-12-04T14:30:00",
                "location": "Germination Chamber",
                "quantity": 195,
                "operator": "System",
                "notes": "97.5% germination rate - excellent"
            },
            {
                "event_id": str(uuid.uuid4()),
                "batch_id": demo_batch_id,
                "event_type": EventType.TRANSPLANT,
                "timestamp": "2024-12-08T09:00:00",
                "location": "Zone A - Shelf 2",
                "quantity": 195,
                "operator": "Mike Chen",
                "notes": "Transplanted to NFT system. Plants healthy and vigorous"
            },
            {
                "event_id": str(uuid.uuid4()),
                "batch_id": demo_batch_id,
                "event_type": EventType.INSPECTION,
                "timestamp": "2024-12-15T11:00:00",
                "location": "Zone A - Shelf 2",
                "operator": "Sarah Johnson",
                "notes": "Quality check - leaves developing well, no pests, pH 6.2"
            }
        ]
        
        for event in events:
            self.events[event["event_id"]] = event

db = BatchDatabase()

# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.post("/api/traceability/batches/create")
async def create_batch(batch: CreateBatch):
    """Create new batch"""
    batch_id = f"BATCH-{datetime.now().strftime('%Y-%m-%d-%H%M%S')}"
    
    batch_data = {
        "batch_id": batch_id,
        "crop_name": batch.crop_name,
        "variety": batch.variety,
        "seed_source": batch.seed_source,
        "quantity": batch.quantity,
        "location": batch.location,
        "status": BatchStatus.SEEDED,
        "created_date": datetime.now().isoformat(),
        "expected_harvest_date": batch.expected_harvest_date,
        "notes": batch.notes
    }
    
    db.batches[batch_id] = batch_data
    
    # Create initial seed event
    event_id = str(uuid.uuid4())
    db.events[event_id] = {
        "event_id": event_id,
        "batch_id": batch_id,
        "event_type": EventType.SEED,
        "timestamp": datetime.now().isoformat(),
        "location": batch.location,
        "quantity": batch.quantity,
        "operator": "System",
        "notes": batch.notes or f"Created batch of {batch.quantity} {batch.crop_name}"
    }
    
    return {
        "ok": True,
        "batch_id": batch_id,
        "message": f"Batch {batch_id} created successfully"
    }

@router.get("/api/traceability/batches/list")
async def list_batches(status: Optional[str] = None, crop: Optional[str] = None):
    """List all batches with optional filters"""
    batches = list(db.batches.values())
    
    # Apply filters
    if status:
        batches = [b for b in batches if b["status"] == status]
    if crop:
        batches = [b for b in batches if crop.lower() in b["crop_name"].lower()]
    
    # Sort by created date (newest first)
    batches.sort(key=lambda x: x["created_date"], reverse=True)
    
    # Add event count for each batch
    for batch in batches:
        batch["event_count"] = len([e for e in db.events.values() if e["batch_id"] == batch["batch_id"]])
    
    return {
        "ok": True,
        "batches": batches,
        "total": len(batches)
    }

@router.get("/api/traceability/batches/{batch_id}")
async def get_batch(batch_id: str):
    """Get batch details with full lifecycle"""
    if batch_id not in db.batches:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    batch = db.batches[batch_id]
    
    # Get all events for this batch
    events = [e for e in db.events.values() if e["batch_id"] == batch_id]
    events.sort(key=lambda x: x["timestamp"])
    
    # Get sales links
    sales = [s for s in db.sales_links.values() if s["batch_id"] == batch_id]
    
    # Calculate totals
    total_sold = sum(s["quantity_sold"] for s in sales)
    total_revenue = sum(s["quantity_sold"] * s["price_per_unit"] for s in sales)
    
    return {
        "ok": True,
        "batch": batch,
        "events": events,
        "sales": sales,
        "summary": {
            "total_events": len(events),
            "total_sold": total_sold,
            "total_revenue": round(total_revenue, 2),
            "quantity_remaining": batch["quantity"] - total_sold
        }
    }

@router.post("/api/traceability/events/record")
async def record_event(event: BatchEvent):
    """Record lifecycle event"""
    if event.batch_id not in db.batches:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    event_id = str(uuid.uuid4())
    
    event_data = {
        "event_id": event_id,
        "batch_id": event.batch_id,
        "event_type": event.event_type,
        "timestamp": event.timestamp or datetime.now().isoformat(),
        "location": event.location,
        "quantity": event.quantity,
        "operator": event.operator,
        "notes": event.notes,
        "photo_url": event.photo_url,
        "metadata": event.metadata
    }
    
    db.events[event_id] = event_data
    
    # Update batch status based on event type
    status_map = {
        EventType.GERMINATE: BatchStatus.GERMINATING,
        EventType.TRANSPLANT: BatchStatus.TRANSPLANTED,
        EventType.HARVEST: BatchStatus.HARVESTED,
        EventType.PACK: BatchStatus.PACKED,
        EventType.SALE: BatchStatus.SOLD
    }
    
    if event.event_type in status_map:
        db.batches[event.batch_id]["status"] = status_map[event.event_type]
        
        # Update quantity if harvested
        if event.event_type == EventType.HARVEST and event.quantity:
            db.batches[event.batch_id]["harvested_quantity"] = event.quantity
    
    return {
        "ok": True,
        "event_id": event_id,
        "message": f"Event recorded for batch {event.batch_id}"
    }

@router.post("/api/traceability/sales/link")
async def link_sale(sale: LinkSale):
    """Link batch to sale for complete traceability"""
    if sale.batch_id not in db.batches:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    sale_id = str(uuid.uuid4())
    
    sale_data = {
        "sale_id": sale_id,
        "batch_id": sale.batch_id,
        "order_id": sale.order_id,
        "quantity_sold": sale.quantity_sold,
        "unit": sale.unit,
        "price_per_unit": sale.price_per_unit,
        "buyer_name": sale.buyer_name,
        "sale_date": sale.sale_date,
        "total_amount": sale.quantity_sold * sale.price_per_unit
    }
    
    db.sales_links[sale_id] = sale_data
    
    # Create sale event
    event_id = str(uuid.uuid4())
    db.events[event_id] = {
        "event_id": event_id,
        "batch_id": sale.batch_id,
        "event_type": EventType.SALE,
        "timestamp": sale.sale_date,
        "quantity": sale.quantity_sold,
        "operator": "System",
        "notes": f"Sold to {sale.buyer_name} - Order #{sale.order_id}",
        "metadata": {"sale_id": sale_id, "revenue": sale_data["total_amount"]}
    }
    
    # Update batch status
    db.batches[sale.batch_id]["status"] = BatchStatus.SOLD
    
    return {
        "ok": True,
        "sale_id": sale_id,
        "message": f"Sale linked to batch {sale.batch_id}"
    }

@router.get("/api/traceability/batches/{batch_id}/report")
async def generate_traceability_report(batch_id: str):
    """Generate complete traceability report"""
    if batch_id not in db.batches:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    batch = db.batches[batch_id]
    events = [e for e in db.events.values() if e["batch_id"] == batch_id]
    events.sort(key=lambda x: x["timestamp"])
    sales = [s for s in db.sales_links.values() if s["batch_id"] == batch_id]
    
    # Build timeline
    timeline = []
    for event in events:
        timeline.append({
            "date": event["timestamp"],
            "stage": event["event_type"],
            "description": event["notes"],
            "location": event.get("location"),
            "operator": event.get("operator"),
            "quantity": event.get("quantity")
        })
    
    report = {
        "batch_id": batch_id,
        "crop": batch["crop_name"],
        "variety": batch.get("variety"),
        "seed_source": batch["seed_source"],
        "origin": {
            "date_seeded": batch["created_date"],
            "location": batch["location"],
            "initial_quantity": batch["quantity"]
        },
        "lifecycle": timeline,
        "sales": [
            {
                "buyer": s["buyer_name"],
                "date": s["sale_date"],
                "quantity": s["quantity_sold"],
                "unit": s["unit"],
                "order_id": s["order_id"]
            }
            for s in sales
        ],
        "summary": {
            "total_events": len(events),
            "days_from_seed_to_harvest": self._calculate_days(batch, events),
            "final_status": batch["status"],
            "quantity_sold": sum(s["quantity_sold"] for s in sales),
            "revenue_generated": sum(s["total_amount"] for s in sales)
        },
        "generated_at": datetime.now().isoformat()
    }
    
    return {
        "ok": True,
        "report": report
    }

def _calculate_days(batch, events):
    """Calculate days from seed to harvest"""
    harvest_events = [e for e in events if e["event_type"] == EventType.HARVEST]
    if not harvest_events:
        return None
    
    seed_date = datetime.fromisoformat(batch["created_date"])
    harvest_date = datetime.fromisoformat(harvest_events[0]["timestamp"])
    return (harvest_date - seed_date).days

@router.get("/api/traceability/search")
async def search_traceability(query: str):
    """Search batches by crop, variety, batch ID, or seed source"""
    query_lower = query.lower()
    
    matching_batches = []
    for batch in db.batches.values():
        if (query_lower in batch["batch_id"].lower() or
            query_lower in batch["crop_name"].lower() or
            query_lower in batch.get("variety", "").lower() or
            query_lower in batch["seed_source"].lower()):
            
            # Get event count
            event_count = len([e for e in db.events.values() if e["batch_id"] == batch["batch_id"]])
            batch_copy = batch.copy()
            batch_copy["event_count"] = event_count
            matching_batches.append(batch_copy)
    
    return {
        "ok": True,
        "results": matching_batches,
        "count": len(matching_batches),
        "query": query
    }

@router.get("/api/traceability/stats")
async def get_traceability_stats():
    """Get overall traceability statistics"""
    total_batches = len(db.batches)
    total_events = len(db.events)
    total_sales = len(db.sales_links)
    
    # Batches by status
    status_counts = {}
    for batch in db.batches.values():
        status = batch["status"]
        status_counts[status] = status_counts.get(status, 0) + 1
    
    # Total revenue
    total_revenue = sum(s["total_amount"] for s in db.sales_links.values())
    
    return {
        "ok": True,
        "stats": {
            "total_batches": total_batches,
            "total_events": total_events,
            "total_sales": total_sales,
            "total_revenue": round(total_revenue, 2),
            "batches_by_status": status_counts,
            "average_events_per_batch": round(total_events / total_batches, 1) if total_batches > 0 else 0
        }
    }
