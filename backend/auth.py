"""
Authentication and authorization middleware for Light Engine Echo.

Provides JWT-based authentication and role-based access control (RBAC).
"""

import os
from datetime import datetime, timedelta
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Header, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.secrets_manager import get_jwt_secret

# JWT Configuration
JWT_SECRET = get_jwt_secret()
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Security scheme
security = HTTPBearer()


class AuthenticationError(HTTPException):
    """Custom authentication exception."""
    
    def __init__(self, detail: str = "Authentication failed"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class AuthorizationError(HTTPException):
    """Custom authorization exception."""
    
    def __init__(self, detail: str = "Insufficient permissions"):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


def create_access_token(user_id: str, tenant_id: str, role: str = "viewer") -> str:
    """
    Create a JWT access token.
    
    Args:
        user_id: Unique user identifier
        tenant_id: Tenant identifier for multi-tenant isolation
        role: User role (admin, operator, viewer)
    
    Returns:
        JWT token string
    """
    expiration = datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "role": role,
        "exp": expiration,
        "iat": datetime.utcnow(),
    }
    
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def verify_token(
    credentials: HTTPAuthorizationCredentials = Security(security)
) -> dict:
    """
    Verify JWT token and extract claims.
    
    Args:
        credentials: HTTP Authorization header with Bearer token
    
    Returns:
        Token payload dictionary with user_id, tenant_id, role
    
    Raises:
        AuthenticationError: If token is invalid, expired, or malformed
    """
    token = credentials.credentials
    
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise AuthenticationError("Token has expired")
    except jwt.InvalidTokenError:
        raise AuthenticationError("Invalid token")


async def get_current_user(token_payload: dict = Depends(verify_token)) -> dict:
    """
    Extract current user from verified token.
    
    Args:
        token_payload: Verified JWT payload
    
    Returns:
        User information dictionary
    """
    return {
        "user_id": token_payload.get("sub"),
        "tenant_id": token_payload.get("tenant_id"),
        "role": token_payload.get("role", "viewer"),
    }


async def get_tenant_id(
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    user: dict = Depends(get_current_user)
) -> str:
    """
    Extract and validate tenant ID from header or token.
    
    Validates that the user has access to the requested tenant.
    
    Args:
        x_tenant_id: Tenant ID from X-Tenant-ID header (optional)
        user: Current authenticated user
    
    Returns:
        Validated tenant ID
    
    Raises:
        HTTPException: If tenant ID is missing or user lacks access
    """
    # If tenant ID provided in header, validate against user's tenant
    if x_tenant_id:
        if x_tenant_id != user["tenant_id"]:
            raise AuthorizationError(
                "Access denied: You do not have access to this tenant"
            )
        return x_tenant_id
    
    # Otherwise, use tenant from token
    if not user.get("tenant_id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Tenant-ID header required or tenant must be in token"
        )
    
    return user["tenant_id"]


def require_role(*allowed_roles: str):
    """
    Dependency to require specific role(s).
    
    Usage:
        @app.get("/admin/users")
        async def list_users(user: dict = Depends(require_role("admin"))):
            ...
    
    Args:
        allowed_roles: Roles that are permitted (e.g., "admin", "operator")
    
    Returns:
        Dependency function that validates role
    """
    async def role_checker(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in allowed_roles:
            raise AuthorizationError(
                f"Access denied: Requires one of roles: {', '.join(allowed_roles)}"
            )
        return user
    
    return role_checker


# Convenience dependencies
require_admin = require_role("admin")
require_operator = require_role("admin", "operator")


# Optional: API Key authentication (alternative to JWT)
async def verify_api_key(x_api_key: str = Header(..., alias="X-API-Key")) -> dict:
    """
    Verify API key authentication (alternative to JWT).
    
    Args:
        x_api_key: API key from X-API-Key header
    
    Returns:
        User information dictionary
    
    Raises:
        AuthenticationError: If API key is invalid
    
    Note:
        API keys should be stored in database with associated tenant_id and permissions.
        This is a placeholder implementation.
    """
    # TODO: Implement actual API key validation against database
    # For now, accept any key for backwards compatibility
    
    if not x_api_key or len(x_api_key) < 16:
        raise AuthenticationError("Invalid API key")
    
    # Placeholder: In production, look up API key in database
    return {
        "user_id": "api_key_user",
        "tenant_id": "default",
        "role": "operator",
        "auth_method": "api_key"
    }
