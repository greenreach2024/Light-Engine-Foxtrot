"""
Authentication routes for user registration, login, and password reset.
"""

import os
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, status, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .models.base import get_db, engine, Base
from .models.user import User, PasswordResetToken
from .auth import create_access_token
from .email import EmailService, get_password_reset_template, get_welcome_template
from .audit_logger import (
    log_login_success,
    log_login_failure,
    log_user_registered,
    log_password_reset_requested,
    log_password_reset_completed,
    log_token_generated,
)

router = APIRouter(prefix="/auth", tags=["authentication"])

# Initialize email service
email_service = EmailService()

# Ensure database tables exist on module import
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    print(f"Warning: Could not create database tables: {e}")


# Request/Response Models
class RegisterRequest(BaseModel):
    """User registration request."""
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=8, description="Password (min 8 characters)")
    first_name: Optional[str] = Field(None, max_length=100, description="First name")
    last_name: Optional[str] = Field(None, max_length=100, description="Last name")
    tenant_id: Optional[str] = Field(None, description="Tenant ID (optional)")
    role: str = Field(default="operator", description="User role (admin, operator, viewer)")


class LoginRequest(BaseModel):
    """User login request."""
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., description="User password")


class ForgotPasswordRequest(BaseModel):
    """Forgot password request."""
    email: EmailStr = Field(..., description="User email address")


class ResetPasswordRequest(BaseModel):
    """Reset password request."""
    token: str = Field(..., description="Password reset token")
    new_password: str = Field(..., min_length=8, description="New password (min 8 characters)")


class AuthResponse(BaseModel):
    """Authentication response with JWT token."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 86400
    user: dict


# Routes
@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(request: RegisterRequest, req: Request, db: Session = Depends(get_db)) -> AuthResponse:
    """
    Register a new user account.
    
    **Validation:**
    - Email must be unique
    - Password must be at least 8 characters
    - Role must be: admin, operator, or viewer
    
    **Returns:**
    - JWT access token
    - User profile information
    
    **Example request:**
    ```json
    {
      "email": "user@farm.com",
      "password": "SecurePass123!",
      "first_name": "John",
      "last_name": "Farmer",
      "role": "operator"
    }
    ```
    """
    # Validate role
    valid_roles = ["admin", "operator", "viewer"]
    if request.role not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}"
        )
    
    # Check if email already exists
    existing_user = db.query(User).filter(User.email == request.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered"
        )
    
    # Create new user
    user = User(
        id=str(uuid.uuid4()),
        email=request.email,
        first_name=request.first_name,
        last_name=request.last_name,
        role=request.role,
        tenant_id=request.tenant_id or str(uuid.uuid4()),  # Generate tenant if not provided
        email_verified=False,
        is_active=True,
    )
    
    # Hash password
    user.set_password(request.password)
    
    # Save to database
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Log successful registration
    log_user_registered(str(user.id), user.email, user.role, req)
    
    # Send welcome email (optional, non-blocking)
    try:
        login_url = os.getenv("APP_URL", "http://localhost:3000") + "/login"
        user_display_name = f"{user.first_name} {user.last_name}".strip() if user.first_name or user.last_name else user.email.split('@')[0]
        template = get_welcome_template(
            user_name=user_display_name,
            login_url=login_url
        )
        
        email_service.send_email(
            to_email=user.email,
            subject=template.subject,
            html_body=template.html_body,
            text_body=template.text_body
        )
    except Exception as e:
        print(f"  Could not send welcome email to {user.email}: {e}")
    
    # Generate JWT token
    token = create_access_token(
        user_id=str(user.id),
        tenant_id=str(user.tenant_id),
        role=user.role
    )
    
    # Return token and user info
    return AuthResponse(
        access_token=token,
        token_type="bearer",
        expires_in=86400,
        user=user.to_dict()
    )


@router.post("/login")
async def login(request: LoginRequest, req: Request, db: Session = Depends(get_db)) -> AuthResponse:
    """
    Authenticate user and return JWT token.
    
    **Validates:**
    - Email exists
    - Password matches
    - Account is active
    
    **Returns:**
    - JWT access token
    - User profile information
    
    **Example request:**
    ```json
    {
      "email": "user@farm.com",
      "password": "SecurePass123!"
    }
    ```
    """
    # Find user by email
    user = db.query(User).filter(User.email == request.email).first()
    
    if not user:
        log_login_failure(request.email, "user_not_found", req)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Verify password
    if not user.verify_password(request.password):
        log_login_failure(request.email, "invalid_password", req)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password"
        )
    
    # Check if account is active
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled"
        )
    
    # Update last login timestamp
    user.last_login = datetime.utcnow()
    db.commit()
    
    # Generate JWT token
    token = create_access_token(
        user_id=str(user.id),
        tenant_id=str(user.tenant_id),
        role=user.role
    )
    
    # Log successful login
    log_login_success(str(user.id), user.email, req)
    
    # Return token and user info
    return AuthResponse(
        access_token=token,
        token_type="bearer",
        expires_in=86400,
        user=user.to_dict()
    )


@router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest, req: Request, db: Session = Depends(get_db)) -> dict:
    """
    Initiate password reset flow.
    
    Generates a secure reset token and sends email with reset link.
    
    **Note:** In production, this should:
    1. Send email with reset link to user
    2. Rate limit to 5 attempts per hour per email
    3. Log all reset attempts for security monitoring
    
    **Example request:**
    ```json
    {
      "email": "user@farm.com"
    }
    ```
    """
    # Find user by email
    user = db.query(User).filter(User.email == request.email).first()
    
    # Always return success (don't reveal if email exists)
    # This prevents email enumeration attacks
    if not user:
        # Log attempt even for non-existent users (security monitoring)
        log_password_reset_requested(request.email, req)
        return {
            "message": "If that email exists, a password reset link has been sent",
            "email": request.email
        }
    
    # Log password reset request for existing user
    log_password_reset_requested(request.email, req)
    
    # Create password reset token
    reset_token = PasswordResetToken.create_for_user(
        user_id=uuid.UUID(user.id) if not isinstance(user.id, str) else user.id,
        expires_in_hours=1
    )
    
    db.add(reset_token)
    db.commit()
    
    # Generate reset URL
    base_url = os.getenv("APP_URL", "http://localhost:3000")
    reset_url = f"{base_url}/reset-password?token={reset_token.token}"
    
    # Send password reset email
    try:
        user_display_name = f"{user.first_name} {user.last_name}".strip() if user.first_name or user.last_name else user.email.split('@')[0]
        template = get_password_reset_template(
            user_name=user_display_name,
            reset_url=reset_url,
            expiration_hours=1
        )
        
        email_sent = email_service.send_email(
            to_email=user.email,
            subject=template.subject,
            html_body=template.html_body,
            text_body=template.text_body
        )
        
        if email_sent:
            print(f" Password reset email sent to {user.email}")
        else:
            print(f"  Failed to send email, but token created: {reset_token.token}")
    except Exception as e:
        print(f" Error sending email: {e}")
        print(f"Reset URL: {reset_url}")
    
    return {
        "message": "If that email exists, a password reset link has been sent",
        "email": request.email,
        "token": reset_token.token if os.getenv("ENVIRONMENT") == "development" else None
    }


@router.post("/reset-password")
async def reset_password(request: ResetPasswordRequest, req: Request, db: Session = Depends(get_db)) -> dict:
    """
    Reset user password with valid token.
    
    **Validates:**
    - Token exists and not expired
    - Token not already used
    - New password meets requirements
    
    **Example request:**
    ```json
    {
      "token": "abc123def456...",
      "new_password": "NewSecurePass123!"
    }
    ```
    """
    # Find reset token
    reset_token = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == request.token
    ).first()
    
    if not reset_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )
    
    # Validate token
    if not reset_token.is_valid():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )
    
    # Find user
    user = db.query(User).filter(User.id == reset_token.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Update password
    user.set_password(request.new_password)
    
    # Mark token as used
    reset_token.mark_as_used()
    
    db.commit()
    
    # Log password reset completion
    log_password_reset_completed(str(user.id), user.email, req)
    
    return {
        "message": "Password successfully reset",
        "email": user.email
    }
