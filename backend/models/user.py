"""
User model for authentication and authorization.
"""

import uuid
import secrets
import os
from datetime import datetime, timedelta
from sqlalchemy import Column, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
import bcrypt

from .base import Base

# Determine if we're using SQLite or PostgreSQL
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./lightengine.db")
USE_SQLITE = DATABASE_URL.startswith("sqlite")

# Import appropriate UUID type
if USE_SQLITE:
    # SQLite doesn't support UUID natively, use String
    def UUID(*args, **kwargs):
        return String(36)
else:
    from sqlalchemy.dialects.postgresql import UUID


class User(Base):
    """
    User account model.
    
    Stores user credentials, profile information, and role-based access control.
    """
    __tablename__ = "users"
    
    # Primary key
    if USE_SQLITE:
        id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    else:
        id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Authentication
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    
    # Profile
    first_name = Column(String(100))
    last_name = Column(String(100))
    
    # Authorization
    role = Column(String(50), nullable=False, default="operator")  # admin, operator, viewer
    if USE_SQLITE:
        tenant_id = Column(String(36), index=True)  # Multi-tenant isolation
    else:
        tenant_id = Column(UUID(as_uuid=True), index=True)  # Multi-tenant isolation
    
    # Account status
    email_verified = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    last_login = Column(DateTime)
    
    # Relationships
    password_reset_tokens = relationship("PasswordResetToken", back_populates="user")
    
    def set_password(self, password: str) -> None:
        """
        Hash and store password securely using bcrypt.
        
        Args:
            password: Plain text password
        """
        # Generate salt and hash password with 12 rounds (recommended for production)
        salt = bcrypt.gensalt(rounds=12)
        self.password_hash = bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')
    
    def verify_password(self, password: str) -> bool:
        """
        Verify password against stored hash.
        
        Args:
            password: Plain text password to verify
        
        Returns:
            True if password matches, False otherwise
        """
        return bcrypt.checkpw(
            password.encode('utf-8'),
            self.password_hash.encode('utf-8')
        )
    
    def to_dict(self) -> dict:
        """
        Convert user to dictionary (excludes password_hash).
        
        Returns:
            Dictionary representation safe for API responses
        """
        return {
            "id": str(self.id),
            "email": self.email,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "role": self.role,
            "tenant_id": str(self.tenant_id) if self.tenant_id else None,
            "email_verified": self.email_verified,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "last_login": self.last_login.isoformat() if self.last_login else None,
        }
    
    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email}, role={self.role})>"


class PasswordResetToken(Base):
    """
    Password reset token model.
    
    Stores secure tokens for password reset flow with expiration.
    """
    __tablename__ = "password_reset_tokens"
    
    # Primary key
    if USE_SQLITE:
        id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    else:
        id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Foreign key to user
    if USE_SQLITE:
        user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    else:
        user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    
    # Token
    token = Column(String(64), unique=True, nullable=False, index=True)
    
    # Expiration and usage
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    used_at = Column(DateTime)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    user = relationship("User", back_populates="password_reset_tokens")
    
    @staticmethod
    def generate_token() -> str:
        """
        Generate cryptographically secure random token.
        
        Returns:
            64-character hexadecimal token
        """
        return secrets.token_hex(32)
    
    @staticmethod
    def create_for_user(user_id: uuid.UUID, expires_in_hours: int = 1) -> "PasswordResetToken":
        """
        Create password reset token for user.
        
        Args:
            user_id: User UUID
            expires_in_hours: Token validity period (default 1 hour)
        
        Returns:
            New PasswordResetToken instance
        """
        return PasswordResetToken(
            user_id=user_id,
            token=PasswordResetToken.generate_token(),
            expires_at=datetime.utcnow() + timedelta(hours=expires_in_hours)
        )
    
    def is_valid(self) -> bool:
        """
        Check if token is still valid (not expired, not used).
        
        Returns:
            True if token can be used, False otherwise
        """
        if self.used:
            return False
        if datetime.utcnow() > self.expires_at:
            return False
        return True
    
    def mark_as_used(self) -> None:
        """Mark token as used to prevent reuse."""
        self.used = True
        self.used_at = datetime.utcnow()
    
    def __repr__(self) -> str:
        return f"<PasswordResetToken(id={self.id}, user_id={self.user_id}, valid={self.is_valid()})>"
