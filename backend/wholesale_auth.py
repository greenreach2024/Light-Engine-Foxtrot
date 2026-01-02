"""
Wholesale Buyer Authentication API
JWT-based authentication for B2B wholesale buyers
"""

from datetime import datetime, timedelta
from typing import Optional
import logging

from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, EmailStr
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from sqlalchemy import and_

from backend.models.base import get_db
from backend.models.inventory import WholesaleBuyer, WholesaleBuyerCredentials
from backend.auth import create_access_token, get_current_user, get_tenant_id

logger = logging.getLogger(__name__)

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class RegisterRequest(BaseModel):
    business_name: str
    contact_name: str
    email: EmailStr
    password: str
    buyer_type: str
    postal_code: Optional[str] = None
    province: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    phone: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class BuyerResponse(BaseModel):
    buyer_id: str
    business_name: str
    contact_name: str
    email: str
    buyer_type: str
    verified: bool
    is_active: bool
    phone: Optional[str] = None
    postal_code: Optional[str] = None
    province: Optional[str] = None


class LoginResponse(BaseModel):
    token: str
    buyer: BuyerResponse


@router.post("/wholesale/auth/register", response_model=LoginResponse)
async def register_buyer(
    request: RegisterRequest,
    tenant_id: str = Depends(get_tenant_id),
    db: Session = Depends(get_db)
):
    """Register a new wholesale buyer account"""
    
    # Check if email already exists
    existing = db.query(WholesaleBuyer).filter(WholesaleBuyer.email == request.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Validate buyer type
    valid_types = ["restaurant", "grocery", "institutional", "distributor"]
    if request.buyer_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid buyer_type. Must be one of: {', '.join(valid_types)}"
        )
    
    # Create buyer account
    buyer = WholesaleBuyer(
        farm_id=tenant_id,
        business_name=request.business_name,
        contact_name=request.contact_name,
        email=request.email,
        phone=request.phone,
        buyer_type=request.buyer_type,
        postal_code=request.postal_code,
        province=request.province,
        lat=request.lat,
        lng=request.lng,
        verified=False,  # Requires farm approval
        is_active=True
    )
    db.add(buyer)
    db.flush()  # Get buyer_id
    
    # Hash password and create credentials
    password_hash = pwd_context.hash(request.password)
    credentials = WholesaleBuyerCredentials(
        buyer_id=str(buyer.buyer_id),
        password_hash=password_hash,
        failed_login_attempts=0
    )
    db.add(credentials)
    db.commit()
    db.refresh(buyer)
    
    # Create JWT token
    token = create_access_token(
        user_id=str(buyer.buyer_id),
        tenant_id=tenant_id,
        role="wholesale_buyer"
    )
    
    logger.info(f"Wholesale buyer registered: {request.email} ({request.business_name})")
    
    return LoginResponse(
        token=token,
        buyer=BuyerResponse(
            buyer_id=str(buyer.buyer_id),
            business_name=buyer.business_name,
            contact_name=buyer.contact_name,
            email=buyer.email,
            buyer_type=buyer.buyer_type,
            verified=buyer.verified,
            is_active=buyer.is_active,
            phone=buyer.phone,
            postal_code=buyer.postal_code,
            province=buyer.province
        )
    )


@router.post("/wholesale/auth/login", response_model=LoginResponse)
async def login_buyer(
    request: LoginRequest,
    db: Session = Depends(get_db)
):
    """Authenticate wholesale buyer and return JWT token"""
    
    # Find buyer by email
    buyer = db.query(WholesaleBuyer).filter(WholesaleBuyer.email == request.email).first()
    if not buyer:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Check if account is active
    if not buyer.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive. Please contact the farm."
        )
    
    # Get credentials
    credentials = db.query(WholesaleBuyerCredentials).filter(
        WholesaleBuyerCredentials.buyer_id == str(buyer.buyer_id)
    ).first()
    
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account credentials not found"
        )
    
    # Check if account is locked
    if credentials.locked_until and credentials.locked_until > datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account locked until {credentials.locked_until.isoformat()}"
        )
    
    # Verify password
    if not pwd_context.verify(request.password, credentials.password_hash):
        # Increment failed attempts
        credentials.failed_login_attempts += 1
        if credentials.failed_login_attempts >= 5:
            credentials.locked_until = datetime.utcnow() + timedelta(minutes=30)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account locked due to too many failed login attempts"
            )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Reset failed attempts and update last login
    credentials.failed_login_attempts = 0
    credentials.locked_until = None
    credentials.last_login = datetime.utcnow()
    db.commit()
    
    # Create JWT token
    token = create_access_token(
        user_id=str(buyer.buyer_id),
        tenant_id=buyer.farm_id,
        role="wholesale_buyer"
    )
    
    logger.info(f"Wholesale buyer logged in: {buyer.email} ({buyer.business_name})")
    
    return LoginResponse(
        token=token,
        buyer=BuyerResponse(
            buyer_id=str(buyer.buyer_id),
            business_name=buyer.business_name,
            contact_name=buyer.contact_name,
            email=buyer.email,
            buyer_type=buyer.buyer_type,
            verified=buyer.verified,
            is_active=buyer.is_active,
            phone=buyer.phone,
            postal_code=buyer.postal_code,
            province=buyer.province
        )
    )


@router.get("/wholesale/auth/me", response_model=BuyerResponse)
async def get_current_buyer(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current authenticated buyer profile"""
    
    buyer_id = current_user.get("user_id")
    buyer = db.query(WholesaleBuyer).filter(WholesaleBuyer.buyer_id == buyer_id).first()
    
    if not buyer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Buyer not found"
        )
    
    return BuyerResponse(
        buyer_id=str(buyer.buyer_id),
        business_name=buyer.business_name,
        contact_name=buyer.contact_name,
        email=buyer.email,
        buyer_type=buyer.buyer_type,
        verified=buyer.verified,
        is_active=buyer.is_active,
        phone=buyer.phone,
        postal_code=buyer.postal_code,
        province=buyer.province
    )


@router.post("/wholesale/auth/logout")
async def logout_buyer():
    """Logout (client should discard JWT token)"""
    return {"message": "Logged out successfully"}
