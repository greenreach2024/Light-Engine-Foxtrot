"""
Quality Control System - QA Checkpoints with Photo Documentation
Formal quality workflows at key production stages
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum
import uuid
import base64

router = APIRouter()

# ============================================================================
# MODELS
# ============================================================================

class CheckpointType(str, Enum):
    """QA checkpoint stages"""
    SEEDING = "seeding"
    GERMINATION = "germination"
    TRANSPLANT = "transplant"
    GROWTH_MIDPOINT = "growth_midpoint"
    PRE_HARVEST = "pre_harvest"
    POST_HARVEST = "post_harvest"
    PACKING = "packing"
    PRE_SHIPMENT = "pre_shipment"

class QAResult(str, Enum):
    """Checkpoint results"""
    PASS = "pass"
    PASS_WITH_NOTES = "pass_with_notes"
    FAIL = "fail"
    PENDING = "pending"

class QACheckpoint(BaseModel):
    """Quality control checkpoint"""
    batch_id: str
    checkpoint_type: CheckpointType
    inspector: str
    result: QAResult
    notes: Optional[str] = None
    photo_data: Optional[str] = None  # Base64 encoded image
    metrics: Optional[Dict[str, Any]] = None  # Custom measurements
    corrective_action: Optional[str] = None

class QACriteria(BaseModel):
    """Quality criteria definition"""
    checkpoint_type: CheckpointType
    crop_type: str
    criteria: List[str]
    pass_threshold: Optional[str] = None

# ============================================================================
# QA STANDARDS DATABASE
# ============================================================================

QA_STANDARDS = {
    CheckpointType.SEEDING: {
        "criteria": [
            "Seeds placed correctly in medium",
            "Proper spacing maintained",
            "Medium moisture level adequate",
            "No contamination visible",
            "Tray labels applied correctly"
        ],
        "pass_threshold": "All criteria met"
    },
    CheckpointType.GERMINATION: {
        "criteria": [
            "Germination rate above 85%",
            "Seedlings uniform in size",
            "No mold or fungus present",
            "Root development visible",
            "Cotyledons fully opened"
        ],
        "pass_threshold": "Minimum 85% germination"
    },
    CheckpointType.TRANSPLANT: {
        "criteria": [
            "Plants transferred without damage",
            "Roots properly positioned",
            "Proper depth in growing medium",
            "No wilting observed",
            "Spacing meets specifications"
        ],
        "pass_threshold": "Less than 5% damage"
    },
    CheckpointType.GROWTH_MIDPOINT: {
        "criteria": [
            "Growth rate on target",
            "Color and vigor good",
            "No pest damage visible",
            "No nutrient deficiency signs",
            "Proper size for stage"
        ],
        "pass_threshold": "No major issues"
    },
    CheckpointType.PRE_HARVEST: {
        "criteria": [
            "Size meets harvest specifications",
            "Color appropriate for variety",
            "No pest damage",
            "No disease symptoms",
            "Texture and firmness good"
        ],
        "pass_threshold": "Market-ready quality"
    },
    CheckpointType.POST_HARVEST: {
        "criteria": [
            "Clean harvest - no debris",
            "No damage from harvesting",
            "Proper temperature maintained",
            "Weight meets expectations",
            "Quality grade A or B"
        ],
        "pass_threshold": "Grade A: 80%+, Grade B acceptable"
    },
    CheckpointType.PACKING: {
        "criteria": [
            "Product cleaned properly",
            "Packaging intact and clean",
            "Weight accurate",
            "Labels correct and legible",
            "No foreign matter present"
        ],
        "pass_threshold": "Zero critical defects"
    },
    CheckpointType.PRE_SHIPMENT: {
        "criteria": [
            "Temperature within range",
            "Packaging secure",
            "Documentation complete",
            "Traceability codes visible",
            "Expiry dates correct"
        ],
        "pass_threshold": "All shipping requirements met"
    }
}

# ============================================================================
# DATABASE (PLACEHOLDER)
# ============================================================================

class QADatabase:
    """In-memory database placeholder"""
    
    def __init__(self):
        self.checkpoints = {}
        self.photos = {}
        self._init_demo_data()
    
    def _init_demo_data(self):
        """Initialize with demo QA records - controlled by demo_config.py"""
        from .demo_config import should_use_demo_data
        if not should_use_demo_data("quality_control"):
            return  # Skip demo data in production
            
        demo_checkpoint_id = str(uuid.uuid4())
        
        self.checkpoints[demo_checkpoint_id] = {
            "checkpoint_id": demo_checkpoint_id,
            "batch_id": "BATCH-2024-001",
            "checkpoint_type": CheckpointType.GERMINATION,
            "inspector": "Sarah Johnson",
            "result": QAResult.PASS,
            "timestamp": "2024-12-04T14:30:00",
            "notes": "Excellent germination rate at 97.5%. Seedlings uniform and healthy.",
            "metrics": {
                "germination_rate": 97.5,
                "average_height_mm": 15,
                "uniform_color": True
            },
            "photo_count": 1
        }

db = QADatabase()

# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.post("/api/quality/checkpoints/record")
async def record_checkpoint(checkpoint: QACheckpoint):
    """Record quality control checkpoint"""
    
    checkpoint_id = str(uuid.uuid4())
    
    checkpoint_data = {
        "checkpoint_id": checkpoint_id,
        "batch_id": checkpoint.batch_id,
        "checkpoint_type": checkpoint.checkpoint_type,
        "inspector": checkpoint.inspector,
        "result": checkpoint.result,
        "timestamp": datetime.now().isoformat(),
        "notes": checkpoint.notes,
        "metrics": checkpoint.metrics,
        "corrective_action": checkpoint.corrective_action,
        "photo_count": 1 if checkpoint.photo_data else 0
    }
    
    db.checkpoints[checkpoint_id] = checkpoint_data
    
    # Store photo separately if provided
    if checkpoint.photo_data:
        photo_id = str(uuid.uuid4())
        db.photos[photo_id] = {
            "photo_id": photo_id,
            "checkpoint_id": checkpoint_id,
            "batch_id": checkpoint.batch_id,
            "data": checkpoint.photo_data,
            "uploaded_at": datetime.now().isoformat()
        }
        checkpoint_data["photo_id"] = photo_id
    
    # If failed, trigger alert (in real system)
    if checkpoint.result == QAResult.FAIL:
        # Log to batch traceability system
        print(f"QUALITY ALERT: Batch {checkpoint.batch_id} failed {checkpoint.checkpoint_type} checkpoint")
    
    return {
        "ok": True,
        "checkpoint_id": checkpoint_id,
        "message": f"QA checkpoint recorded - Result: {checkpoint.result}",
        "requires_action": checkpoint.result == QAResult.FAIL
    }

@router.get("/api/quality/checkpoints/batch/{batch_id}")
async def get_batch_checkpoints(batch_id: str):
    """Get all QA checkpoints for a batch"""
    
    checkpoints = [c for c in db.checkpoints.values() if c["batch_id"] == batch_id]
    checkpoints.sort(key=lambda x: x["timestamp"])
    
    # Calculate QA score
    if checkpoints:
        pass_count = len([c for c in checkpoints if c["result"] == QAResult.PASS])
        total_count = len(checkpoints)
        qa_score = (pass_count / total_count) * 100
        
        failed_checkpoints = [c for c in checkpoints if c["result"] == QAResult.FAIL]
    else:
        qa_score = 0
        failed_checkpoints = []
    
    return {
        "ok": True,
        "batch_id": batch_id,
        "checkpoints": checkpoints,
        "summary": {
            "total_checkpoints": len(checkpoints),
            "passed": len([c for c in checkpoints if c["result"] == QAResult.PASS]),
            "failed": len(failed_checkpoints),
            "pending": len([c for c in checkpoints if c["result"] == QAResult.PENDING]),
            "qa_score": round(qa_score, 1),
            "certification_ready": qa_score >= 95 and len(failed_checkpoints) == 0
        }
    }

@router.get("/api/quality/standards/{checkpoint_type}")
async def get_qa_standards(checkpoint_type: CheckpointType):
    """Get QA standards for checkpoint type"""
    
    if checkpoint_type not in QA_STANDARDS:
        raise HTTPException(status_code=404, detail="Standards not found for this checkpoint type")
    
    standards = QA_STANDARDS[checkpoint_type]
    
    return {
        "ok": True,
        "checkpoint_type": checkpoint_type,
        "standards": standards
    }

@router.get("/api/quality/checkpoints/list")
async def list_all_checkpoints(
    result: Optional[str] = None,
    checkpoint_type: Optional[str] = None,
    inspector: Optional[str] = None,
    days: Optional[int] = 7
):
    """List QA checkpoints with filters"""
    
    checkpoints = list(db.checkpoints.values())
    
    # Apply filters
    if result:
        checkpoints = [c for c in checkpoints if c["result"] == result]
    if checkpoint_type:
        checkpoints = [c for c in checkpoints if c["checkpoint_type"] == checkpoint_type]
    if inspector:
        checkpoints = [c for c in checkpoints if c["inspector"].lower() == inspector.lower()]
    
    # Filter by date range
    if days:
        cutoff_date = datetime.now() - timedelta(days=days)
        checkpoints = [c for c in checkpoints 
                      if datetime.fromisoformat(c["timestamp"]) >= cutoff_date]
    
    # Sort by timestamp (newest first)
    checkpoints.sort(key=lambda x: x["timestamp"], reverse=True)
    
    return {
        "ok": True,
        "checkpoints": checkpoints,
        "total": len(checkpoints),
        "filters_applied": {
            "result": result,
            "checkpoint_type": checkpoint_type,
            "inspector": inspector,
            "days": days
        }
    }

@router.get("/api/quality/photos/{checkpoint_id}")
async def get_checkpoint_photos(checkpoint_id: str):
    """Get photos for a checkpoint"""
    
    if checkpoint_id not in db.checkpoints:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    
    photos = [p for p in db.photos.values() if p["checkpoint_id"] == checkpoint_id]
    
    return {
        "ok": True,
        "checkpoint_id": checkpoint_id,
        "photos": photos,
        "count": len(photos)
    }

@router.post("/api/quality/photos/upload")
async def upload_qa_photo(
    checkpoint_id: str = Form(...),
    photo: UploadFile = File(...)
):
    """Upload QA photo"""
    
    if checkpoint_id not in db.checkpoints:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    
    # Read photo data
    photo_data = await photo.read()
    photo_base64 = base64.b64encode(photo_data).decode('utf-8')
    
    photo_id = str(uuid.uuid4())
    
    db.photos[photo_id] = {
        "photo_id": photo_id,
        "checkpoint_id": checkpoint_id,
        "batch_id": db.checkpoints[checkpoint_id]["batch_id"],
        "filename": photo.filename,
        "content_type": photo.content_type,
        "data": photo_base64,
        "uploaded_at": datetime.now().isoformat()
    }
    
    # Update photo count
    db.checkpoints[checkpoint_id]["photo_count"] = db.checkpoints[checkpoint_id].get("photo_count", 0) + 1
    
    return {
        "ok": True,
        "photo_id": photo_id,
        "message": "Photo uploaded successfully"
    }

@router.get("/api/quality/stats")
async def get_qa_stats(days: int = 30):
    """Get QA statistics"""
    
    # Filter recent checkpoints
    cutoff_date = datetime.now() - timedelta(days=days)
    recent_checkpoints = [c for c in db.checkpoints.values() 
                         if datetime.fromisoformat(c["timestamp"]) >= cutoff_date]
    
    if not recent_checkpoints:
        return {
            "ok": True,
            "stats": {
                "total_checkpoints": 0,
                "period_days": days
            }
        }
    
    # Calculate stats
    total = len(recent_checkpoints)
    passed = len([c for c in recent_checkpoints if c["result"] == QAResult.PASS])
    failed = len([c for c in recent_checkpoints if c["result"] == QAResult.FAIL])
    pending = len([c for c in recent_checkpoints if c["result"] == QAResult.PENDING])
    
    pass_rate = (passed / total * 100) if total > 0 else 0
    
    # Checkpoints by type
    by_type = {}
    for checkpoint in recent_checkpoints:
        cp_type = checkpoint["checkpoint_type"]
        if cp_type not in by_type:
            by_type[cp_type] = {"total": 0, "passed": 0, "failed": 0}
        
        by_type[cp_type]["total"] += 1
        if checkpoint["result"] == QAResult.PASS:
            by_type[cp_type]["passed"] += 1
        elif checkpoint["result"] == QAResult.FAIL:
            by_type[cp_type]["failed"] += 1
    
    # Top inspectors
    inspector_stats = {}
    for checkpoint in recent_checkpoints:
        inspector = checkpoint["inspector"]
        if inspector not in inspector_stats:
            inspector_stats[inspector] = {"total": 0, "passed": 0}
        
        inspector_stats[inspector]["total"] += 1
        if checkpoint["result"] == QAResult.PASS:
            inspector_stats[inspector]["passed"] += 1
    
    # Calculate pass rates for inspectors
    for inspector, stats in inspector_stats.items():
        stats["pass_rate"] = round((stats["passed"] / stats["total"] * 100), 1)
    
    return {
        "ok": True,
        "stats": {
            "period_days": days,
            "total_checkpoints": total,
            "passed": passed,
            "failed": failed,
            "pending": pending,
            "pass_rate": round(pass_rate, 1),
            "photos_captured": len(db.photos),
            "by_checkpoint_type": by_type,
            "by_inspector": inspector_stats,
            "quality_score": round(pass_rate, 1),
            "certification_status": "excellent" if pass_rate >= 95 else "good" if pass_rate >= 85 else "needs_improvement"
        }
    }

@router.get("/api/quality/dashboard")
async def get_qa_dashboard():
    """Get QA dashboard overview"""
    
    # Recent activity (last 7 days)
    stats_7d = await get_qa_stats(days=7)
    
    # Failed checkpoints requiring action
    failed_checkpoints = [c for c in db.checkpoints.values() 
                         if c["result"] == QAResult.FAIL 
                         and "corrective_action" not in c]
    
    # Pending checkpoints
    pending_checkpoints = [c for c in db.checkpoints.values() 
                          if c["result"] == QAResult.PENDING]
    
    # Batches with low QA scores
    batch_scores = {}
    for checkpoint in db.checkpoints.values():
        batch_id = checkpoint["batch_id"]
        if batch_id not in batch_scores:
            batch_scores[batch_id] = {"passed": 0, "total": 0}
        
        batch_scores[batch_id]["total"] += 1
        if checkpoint["result"] == QAResult.PASS:
            batch_scores[batch_id]["passed"] += 1
    
    low_score_batches = []
    for batch_id, scores in batch_scores.items():
        score = (scores["passed"] / scores["total"] * 100) if scores["total"] > 0 else 0
        if score < 85:
            low_score_batches.append({
                "batch_id": batch_id,
                "qa_score": round(score, 1),
                "checkpoints": scores["total"],
                "failed": scores["total"] - scores["passed"]
            })
    
    return {
        "ok": True,
        "dashboard": {
            "recent_stats": stats_7d["stats"],
            "alerts": {
                "failed_checkpoints": len(failed_checkpoints),
                "pending_checkpoints": len(pending_checkpoints),
                "low_score_batches": len(low_score_batches)
            },
            "failed_requiring_action": failed_checkpoints[:5],  # Top 5
            "pending": pending_checkpoints[:5],
            "batches_needing_attention": low_score_batches
        }
    }

from datetime import timedelta
