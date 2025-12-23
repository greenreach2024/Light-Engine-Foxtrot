"""
Grower Management API (Multi-Tenant)
Manage grower network, farm relationships, contracts, and performance metrics
Supports GreenReach Central broker network coordination
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict
from datetime import datetime, timedelta
from enum import Enum
import uuid

router = APIRouter()

# ============================================================================
# ENUMS
# ============================================================================

class GrowerStatus(str, Enum):
    ACTIVE = "active"
    PENDING = "pending"
    SUSPENDED = "suspended"
    INACTIVE = "inactive"

class ContractStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    EXPIRED = "expired"
    TERMINATED = "terminated"

class PricingTier(str, Enum):
    STANDARD = "standard"
    PREFERRED = "preferred"
    PREMIUM = "premium"
    CUSTOM = "custom"

class InvitationStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    EXPIRED = "expired"

# ============================================================================
# MODELS
# ============================================================================

class GrowerProfile(BaseModel):
    grower_id: str
    business_name: str
    owner_name: str
    email: EmailStr
    phone: str
    address: str
    city: str
    province: str
    postal_code: str
    status: GrowerStatus
    pricing_tier: PricingTier
    joined_date: str
    last_activity: str
    total_farms: int
    performance_score: float  # 0-100
    
class FarmAssignment(BaseModel):
    assignment_id: str
    grower_id: str
    farm_id: str
    farm_name: str
    location: str
    capacity_sqft: int
    certifications: List[str]
    assigned_date: str
    is_primary: bool
    
class Contract(BaseModel):
    contract_id: str
    grower_id: str
    broker_id: str
    contract_type: str  # "supply", "exclusive", "spot"
    status: ContractStatus
    start_date: str
    end_date: str
    terms: str
    pricing_tier: PricingTier
    minimum_volume_lbs_monthly: int
    commission_percent: float
    signed_date: Optional[str] = None
    
class GrowerInvitation(BaseModel):
    invitation_id: str
    broker_id: str
    grower_email: str
    business_name: str
    invited_date: str
    expires_date: str
    status: InvitationStatus
    invitation_code: str
    message: Optional[str] = None

class PerformanceMetrics(BaseModel):
    grower_id: str
    period_days: int
    orders_accepted: int
    orders_declined: int
    acceptance_rate: float
    avg_response_time_minutes: int
    on_time_fulfillment_rate: float
    quality_score: float  # 0-100 based on buyer ratings
    revenue_cad: float
    performance_score: float  # Overall score 0-100

# ============================================================================
# IN-MEMORY STORAGE
# ============================================================================

growers_db: List[GrowerProfile] = []
farms_db: List[FarmAssignment] = []
contracts_db: List[Contract] = []
invitations_db: List[GrowerInvitation] = []
performance_db: Dict[str, PerformanceMetrics] = {}

# ============================================================================
# DEMO DATA
# ============================================================================

def initialize_demo_data():
    """Initialize demo grower network with 5 growers and performance data"""
    global growers_db, farms_db, contracts_db, invitations_db, performance_db
    
    growers_db = []
    farms_db = []
    contracts_db = []
    invitations_db = []
    performance_db = {}
    
    # 5 Demo growers with varying performance
    demo_growers = [
        {
            "business_name": "Sunrise Vertical Farms",
            "owner_name": "Sarah Chen",
            "email": "sarah@sunrisevertical.ca",
            "phone": "416-555-0101",
            "address": "123 Harvest Lane",
            "city": "Toronto",
            "province": "ON",
            "postal_code": "M5V 2A1",
            "status": GrowerStatus.ACTIVE,
            "pricing_tier": PricingTier.PREMIUM,
            "joined_days_ago": 365,
            "last_activity_days_ago": 1,
            "total_farms": 2,
            "performance": {
                "orders_accepted": 145,
                "orders_declined": 5,
                "avg_response_minutes": 12,
                "on_time_rate": 0.98,
                "quality_score": 95.0,
                "revenue_cad": 128500.0
            }
        },
        {
            "business_name": "Green Horizon Hydroponics",
            "owner_name": "Michael Rodriguez",
            "email": "mike@greenhorizon.ca",
            "phone": "905-555-0202",
            "address": "456 Farm Road",
            "city": "Mississauga",
            "province": "ON",
            "postal_code": "L5A 1X1",
            "status": GrowerStatus.ACTIVE,
            "pricing_tier": PricingTier.PREFERRED,
            "joined_days_ago": 180,
            "last_activity_days_ago": 2,
            "total_farms": 1,
            "performance": {
                "orders_accepted": 89,
                "orders_declined": 12,
                "avg_response_minutes": 25,
                "on_time_rate": 0.92,
                "quality_score": 88.0,
                "revenue_cad": 67200.0
            }
        },
        {
            "business_name": "Urban Harvest Co-op",
            "owner_name": "Emma Thompson",
            "email": "emma@urbanharvest.ca",
            "phone": "647-555-0303",
            "address": "789 City Farm Blvd",
            "city": "Toronto",
            "province": "ON",
            "postal_code": "M4C 1B1",
            "status": GrowerStatus.ACTIVE,
            "pricing_tier": PricingTier.STANDARD,
            "joined_days_ago": 90,
            "last_activity_days_ago": 1,
            "total_farms": 3,
            "performance": {
                "orders_accepted": 56,
                "orders_declined": 8,
                "avg_response_minutes": 35,
                "on_time_rate": 0.87,
                "quality_score": 82.0,
                "revenue_cad": 45300.0
            }
        },
        {
            "business_name": "NextGen Greens",
            "owner_name": "David Kim",
            "email": "david@nextgengreens.ca",
            "phone": "289-555-0404",
            "address": "321 Innovation Dr",
            "city": "Waterloo",
            "province": "ON",
            "postal_code": "N2L 3G1",
            "status": GrowerStatus.PENDING,
            "pricing_tier": PricingTier.STANDARD,
            "joined_days_ago": 15,
            "last_activity_days_ago": 3,
            "total_farms": 1,
            "performance": {
                "orders_accepted": 8,
                "orders_declined": 2,
                "avg_response_minutes": 45,
                "on_time_rate": 0.75,
                "quality_score": 78.0,
                "revenue_cad": 5400.0
            }
        },
        {
            "business_name": "EcoLeaf Vertical",
            "owner_name": "Jennifer Wilson",
            "email": "jen@ecoleaf.ca",
            "phone": "519-555-0505",
            "address": "654 Green Street",
            "city": "London",
            "province": "ON",
            "postal_code": "N6A 1H1",
            "status": GrowerStatus.SUSPENDED,
            "pricing_tier": PricingTier.STANDARD,
            "joined_days_ago": 120,
            "last_activity_days_ago": 45,
            "total_farms": 1,
            "performance": {
                "orders_accepted": 42,
                "orders_declined": 28,
                "avg_response_minutes": 180,
                "on_time_rate": 0.65,
                "quality_score": 68.0,
                "revenue_cad": 18900.0
            }
        }
    ]
    
    for i, grower_data in enumerate(demo_growers):
        grower_id = f"grower_{i+1:03d}"
        joined_date = (datetime.now() - timedelta(days=grower_data["joined_days_ago"])).date().isoformat()
        last_activity = (datetime.now() - timedelta(days=grower_data["last_activity_days_ago"])).date().isoformat()
        
        # Calculate performance score
        perf = grower_data["performance"]
        acceptance_rate = perf["orders_accepted"] / (perf["orders_accepted"] + perf["orders_declined"])
        response_score = max(0, 100 - (perf["avg_response_minutes"] / 60 * 10))  # Penalty for slow response
        performance_score = round(
            (acceptance_rate * 30) * 100 +
            (response_score * 0.20) +
            (perf["on_time_rate"] * 25) +
            (perf["quality_score"] * 0.25)
        , 1)
        
        # Create grower profile
        grower = GrowerProfile(
            grower_id=grower_id,
            business_name=grower_data["business_name"],
            owner_name=grower_data["owner_name"],
            email=grower_data["email"],
            phone=grower_data["phone"],
            address=grower_data["address"],
            city=grower_data["city"],
            province=grower_data["province"],
            postal_code=grower_data["postal_code"],
            status=grower_data["status"],
            pricing_tier=grower_data["pricing_tier"],
            joined_date=joined_date,
            last_activity=last_activity,
            total_farms=grower_data["total_farms"],
            performance_score=performance_score
        )
        growers_db.append(grower)
        
        # Create performance metrics
        performance_db[grower_id] = PerformanceMetrics(
            grower_id=grower_id,
            period_days=30,
            orders_accepted=perf["orders_accepted"],
            orders_declined=perf["orders_declined"],
            acceptance_rate=round(acceptance_rate * 100, 1),
            avg_response_time_minutes=perf["avg_response_minutes"],
            on_time_fulfillment_rate=round(perf["on_time_rate"] * 100, 1),
            quality_score=perf["quality_score"],
            revenue_cad=perf["revenue_cad"],
            performance_score=performance_score
        )
        
        # Create farm assignments
        for farm_num in range(grower_data["total_farms"]):
            farm_id = f"{grower_id}_farm_{farm_num+1}"
            farm = FarmAssignment(
                assignment_id=str(uuid.uuid4()),
                grower_id=grower_id,
                farm_id=farm_id,
                farm_name=f"{grower_data['business_name']} - Site {farm_num+1}",
                location=f"{grower_data['city']}, {grower_data['province']}",
                capacity_sqft=5000 + (farm_num * 2000),
                certifications=["Organic", "Food Safe"] if performance_score > 85 else ["Food Safe"],
                assigned_date=joined_date,
                is_primary=(farm_num == 0)
            )
            farms_db.append(farm)
        
        # Create contracts (only for active/pending growers)
        if grower_data["status"] in [GrowerStatus.ACTIVE, GrowerStatus.PENDING]:
            contract_start = (datetime.now() - timedelta(days=grower_data["joined_days_ago"])).date()
            contract_end = contract_start + timedelta(days=365)
            
            contract = Contract(
                contract_id=str(uuid.uuid4()),
                grower_id=grower_id,
                broker_id="greenreach_central",
                contract_type="supply",
                status=ContractStatus.ACTIVE if grower_data["status"] == GrowerStatus.ACTIVE else ContractStatus.DRAFT,
                start_date=contract_start.isoformat(),
                end_date=contract_end.isoformat(),
                terms=f"Minimum {500 if grower_data['pricing_tier'] == PricingTier.PREMIUM else 300} lbs monthly supply",
                pricing_tier=grower_data["pricing_tier"],
                minimum_volume_lbs_monthly=500 if grower_data["pricing_tier"] == PricingTier.PREMIUM else 300,
                commission_percent=12.0 if grower_data["pricing_tier"] == PricingTier.PREMIUM else 15.0,
                signed_date=joined_date if grower_data["status"] == GrowerStatus.ACTIVE else None
            )
            contracts_db.append(contract)
    
    # Create pending invitations
    pending_invites = [
        {
            "email": "contact@freshleaffarms.ca",
            "business_name": "Fresh Leaf Farms",
            "days_ago": 5
        },
        {
            "email": "info@greenvalley.ca",
            "business_name": "Green Valley Produce",
            "days_ago": 12
        }
    ]
    
    for invite_data in pending_invites:
        invited_date = (datetime.now() - timedelta(days=invite_data["days_ago"])).date()
        expires_date = invited_date + timedelta(days=30)
        
        invitation = GrowerInvitation(
            invitation_id=str(uuid.uuid4()),
            broker_id="greenreach_central",
            grower_email=invite_data["email"],
            business_name=invite_data["business_name"],
            invited_date=invited_date.isoformat(),
            expires_date=expires_date.isoformat(),
            status=InvitationStatus.PENDING,
            invitation_code=str(uuid.uuid4())[:8].upper(),
            message="Join the GreenReach network for wholesale distribution opportunities"
        )
        invitations_db.append(invitation)

# Initialize demo data
initialize_demo_data()

# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/growers/list")
async def list_growers(status: Optional[GrowerStatus] = None):
    """Get list of all growers with optional status filter"""
    filtered = growers_db
    if status:
        filtered = [g for g in growers_db if g.status == status]
    
    # Sort by performance score descending
    sorted_growers = sorted(filtered, key=lambda x: x.performance_score, reverse=True)
    
    return {
        "ok": True,
        "count": len(sorted_growers),
        "growers": sorted_growers
    }

@router.get("/growers/{grower_id}")
async def get_grower_details(grower_id: str):
    """Get detailed information for a specific grower"""
    grower = next((g for g in growers_db if g.grower_id == grower_id), None)
    if not grower:
        raise HTTPException(status_code=404, detail=f"Grower {grower_id} not found")
    
    # Get associated farms
    farms = [f for f in farms_db if f.grower_id == grower_id]
    
    # Get contracts
    contracts = [c for c in contracts_db if c.grower_id == grower_id]
    
    # Get performance metrics
    performance = performance_db.get(grower_id)
    
    return {
        "ok": True,
        "grower": grower,
        "farms": farms,
        "contracts": contracts,
        "performance": performance
    }

@router.post("/growers/create")
async def create_grower(
    business_name: str,
    owner_name: str,
    email: EmailStr,
    phone: str,
    address: str,
    city: str,
    province: str,
    postal_code: str,
    pricing_tier: PricingTier = PricingTier.STANDARD
):
    """Create a new grower profile"""
    # Check for duplicate email
    if any(g.email == email for g in growers_db):
        raise HTTPException(status_code=400, detail="Grower with this email already exists")
    
    grower_id = f"grower_{len(growers_db)+1:03d}"
    now = datetime.now().date().isoformat()
    
    grower = GrowerProfile(
        grower_id=grower_id,
        business_name=business_name,
        owner_name=owner_name,
        email=email,
        phone=phone,
        address=address,
        city=city,
        province=province,
        postal_code=postal_code,
        status=GrowerStatus.PENDING,
        pricing_tier=pricing_tier,
        joined_date=now,
        last_activity=now,
        total_farms=0,
        performance_score=0.0
    )
    
    growers_db.append(grower)
    
    # Initialize performance metrics
    performance_db[grower_id] = PerformanceMetrics(
        grower_id=grower_id,
        period_days=30,
        orders_accepted=0,
        orders_declined=0,
        acceptance_rate=0.0,
        avg_response_time_minutes=0,
        on_time_fulfillment_rate=0.0,
        quality_score=0.0,
        revenue_cad=0.0,
        performance_score=0.0
    )
    
    return {
        "ok": True,
        "message": "Grower created successfully",
        "grower": grower
    }

@router.put("/growers/{grower_id}/status")
async def update_grower_status(grower_id: str, status: GrowerStatus):
    """Update grower status (activate, suspend, etc.)"""
    grower = next((g for g in growers_db if g.grower_id == grower_id), None)
    if not grower:
        raise HTTPException(status_code=404, detail=f"Grower {grower_id} not found")
    
    old_status = grower.status
    grower.status = status
    grower.last_activity = datetime.now().date().isoformat()
    
    return {
        "ok": True,
        "message": f"Grower status updated from {old_status} to {status}",
        "grower": grower
    }

@router.post("/farms/assign")
async def assign_farm(
    grower_id: str,
    farm_name: str,
    location: str,
    capacity_sqft: int,
    certifications: List[str]
):
    """Assign a farm to a grower"""
    grower = next((g for g in growers_db if g.grower_id == grower_id), None)
    if not grower:
        raise HTTPException(status_code=404, detail=f"Grower {grower_id} not found")
    
    farm_id = f"{grower_id}_farm_{len([f for f in farms_db if f.grower_id == grower_id])+1}"
    is_primary = grower.total_farms == 0
    
    farm = FarmAssignment(
        assignment_id=str(uuid.uuid4()),
        grower_id=grower_id,
        farm_id=farm_id,
        farm_name=farm_name,
        location=location,
        capacity_sqft=capacity_sqft,
        certifications=certifications,
        assigned_date=datetime.now().date().isoformat(),
        is_primary=is_primary
    )
    
    farms_db.append(farm)
    grower.total_farms += 1
    
    return {
        "ok": True,
        "message": "Farm assigned successfully",
        "farm": farm
    }

@router.get("/farms/list")
async def list_farms(grower_id: Optional[str] = None):
    """List all farms or farms for a specific grower"""
    filtered = farms_db
    if grower_id:
        filtered = [f for f in farms_db if f.grower_id == grower_id]
    
    return {
        "ok": True,
        "count": len(filtered),
        "farms": filtered
    }

@router.post("/contracts/create")
async def create_contract(
    grower_id: str,
    contract_type: str,
    start_date: str,
    end_date: str,
    terms: str,
    pricing_tier: PricingTier,
    minimum_volume_lbs_monthly: int,
    commission_percent: float
):
    """Create a new contract with a grower"""
    grower = next((g for g in growers_db if g.grower_id == grower_id), None)
    if not grower:
        raise HTTPException(status_code=404, detail=f"Grower {grower_id} not found")
    
    contract = Contract(
        contract_id=str(uuid.uuid4()),
        grower_id=grower_id,
        broker_id="greenreach_central",
        contract_type=contract_type,
        status=ContractStatus.DRAFT,
        start_date=start_date,
        end_date=end_date,
        terms=terms,
        pricing_tier=pricing_tier,
        minimum_volume_lbs_monthly=minimum_volume_lbs_monthly,
        commission_percent=commission_percent,
        signed_date=None
    )
    
    contracts_db.append(contract)
    
    return {
        "ok": True,
        "message": "Contract created successfully",
        "contract": contract
    }

@router.put("/contracts/{contract_id}/sign")
async def sign_contract(contract_id: str):
    """Sign and activate a contract"""
    contract = next((c for c in contracts_db if c.contract_id == contract_id), None)
    if not contract:
        raise HTTPException(status_code=404, detail=f"Contract {contract_id} not found")
    
    if contract.status != ContractStatus.DRAFT:
        raise HTTPException(status_code=400, detail=f"Contract must be in DRAFT status to sign (current: {contract.status})")
    
    contract.status = ContractStatus.ACTIVE
    contract.signed_date = datetime.now().date().isoformat()
    
    # Update grower status to active if signing first contract
    grower = next((g for g in growers_db if g.grower_id == contract.grower_id), None)
    if grower and grower.status == GrowerStatus.PENDING:
        grower.status = GrowerStatus.ACTIVE
    
    return {
        "ok": True,
        "message": "Contract signed and activated",
        "contract": contract
    }

@router.get("/contracts/list")
async def list_contracts(grower_id: Optional[str] = None, status: Optional[ContractStatus] = None):
    """List all contracts with optional filters"""
    filtered = contracts_db
    if grower_id:
        filtered = [c for c in filtered if c.grower_id == grower_id]
    if status:
        filtered = [c for c in filtered if c.status == status]
    
    return {
        "ok": True,
        "count": len(filtered),
        "contracts": filtered
    }

@router.post("/invitations/send")
async def send_invitation(
    grower_email: EmailStr,
    business_name: str,
    message: Optional[str] = None
):
    """Send invitation to join grower network"""
    # Check if already invited or existing grower
    if any(i.grower_email == grower_email and i.status == InvitationStatus.PENDING for i in invitations_db):
        raise HTTPException(status_code=400, detail="Invitation already pending for this email")
    
    if any(g.email == grower_email for g in growers_db):
        raise HTTPException(status_code=400, detail="Grower with this email already exists")
    
    invited_date = datetime.now().date()
    expires_date = invited_date + timedelta(days=30)
    
    invitation = GrowerInvitation(
        invitation_id=str(uuid.uuid4()),
        broker_id="greenreach_central",
        grower_email=grower_email,
        business_name=business_name,
        invited_date=invited_date.isoformat(),
        expires_date=expires_date.isoformat(),
        status=InvitationStatus.PENDING,
        invitation_code=str(uuid.uuid4())[:8].upper(),
        message=message
    )
    
    invitations_db.append(invitation)
    
    return {
        "ok": True,
        "message": f"Invitation sent to {grower_email}",
        "invitation": invitation,
        "invitation_link": f"https://greenreach.app/grower/join?code={invitation.invitation_code}"
    }

@router.get("/invitations/list")
async def list_invitations(status: Optional[InvitationStatus] = None):
    """List all invitations with optional status filter"""
    filtered = invitations_db
    if status:
        filtered = [i for i in invitations_db if i.status == status]
    
    # Sort by invited date descending
    sorted_invites = sorted(filtered, key=lambda x: x.invited_date, reverse=True)
    
    return {
        "ok": True,
        "count": len(sorted_invites),
        "invitations": sorted_invites
    }

@router.get("/performance/{grower_id}")
async def get_grower_performance(grower_id: str):
    """Get performance metrics for a grower"""
    if grower_id not in performance_db:
        raise HTTPException(status_code=404, detail=f"Performance data not found for {grower_id}")
    
    return {
        "ok": True,
        "performance": performance_db[grower_id]
    }

@router.get("/leaderboard")
async def get_leaderboard(limit: int = 10):
    """Get top performing growers"""
    active_growers = [g for g in growers_db if g.status == GrowerStatus.ACTIVE]
    sorted_growers = sorted(active_growers, key=lambda x: x.performance_score, reverse=True)
    top_growers = sorted_growers[:limit]
    
    leaderboard = []
    for rank, grower in enumerate(top_growers, 1):
        perf = performance_db.get(grower.grower_id)
        leaderboard.append({
            "rank": rank,
            "grower_id": grower.grower_id,
            "business_name": grower.business_name,
            "performance_score": grower.performance_score,
            "orders_accepted": perf.orders_accepted if perf else 0,
            "revenue_cad": perf.revenue_cad if perf else 0,
            "quality_score": perf.quality_score if perf else 0
        })
    
    return {
        "ok": True,
        "period": "Last 30 days",
        "count": len(leaderboard),
        "leaderboard": leaderboard
    }

@router.get("/dashboard")
async def get_grower_network_dashboard():
    """Get overview dashboard of grower network"""
    total_growers = len(growers_db)
    active_growers = len([g for g in growers_db if g.status == GrowerStatus.ACTIVE])
    pending_growers = len([g for g in growers_db if g.status == GrowerStatus.PENDING])
    total_farms = len(farms_db)
    active_contracts = len([c for c in contracts_db if c.status == ContractStatus.ACTIVE])
    pending_invitations = len([i for i in invitations_db if i.status == InvitationStatus.PENDING])
    
    # Calculate network-wide metrics
    total_revenue = sum(p.revenue_cad for p in performance_db.values())
    avg_performance = sum(g.performance_score for g in growers_db) / len(growers_db) if growers_db else 0
    
    # Get recent activity
    recent_growers = sorted(growers_db, key=lambda x: x.last_activity, reverse=True)[:5]
    
    return {
        "ok": True,
        "summary": {
            "total_growers": total_growers,
            "active_growers": active_growers,
            "pending_growers": pending_growers,
            "total_farms": total_farms,
            "active_contracts": active_contracts,
            "pending_invitations": pending_invitations
        },
        "network_metrics": {
            "total_revenue_cad": round(total_revenue, 2),
            "average_performance_score": round(avg_performance, 1),
            "network_capacity_sqft": sum(f.capacity_sqft for f in farms_db)
        },
        "recent_activity": [
            {
                "grower_id": g.grower_id,
                "business_name": g.business_name,
                "last_activity": g.last_activity
            } for g in recent_growers
        ]
    }
