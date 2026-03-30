"""
Audit Logging for Python Backend

Provides structured logging for security-sensitive events.
Logs are written to console (for CloudWatch Logs) and optionally to file.
"""

import json
import logging
import os
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Optional
from fastapi import Request

# Configure logging
logger = logging.getLogger("audit")
logger.setLevel(logging.INFO)

# Console handler for CloudWatch
console_handler = logging.StreamHandler()
console_handler.setFormatter(
    logging.Formatter('[AUDIT] %(message)s')
)
logger.addHandler(console_handler)

# File handler (optional)
AUDIT_LOG_ENABLED = os.getenv("AUDIT_LOG_ENABLED", "true").lower() == "true"
AUDIT_LOG_FILE = os.getenv("AUDIT_LOG_FILE", "logs/audit.log")

if AUDIT_LOG_ENABLED:
    try:
        log_dir = Path(AUDIT_LOG_FILE).parent
        log_dir.mkdir(parents=True, exist_ok=True)
        
        file_handler = logging.FileHandler(AUDIT_LOG_FILE)
        file_handler.setFormatter(
            logging.Formatter('%(message)s')
        )
        logger.addHandler(file_handler)
    except Exception as e:
        logger.warning(f"Could not create audit log file handler: {e}")


class AuditEventType(str, Enum):
    """Audit event types."""
    # Authentication
    LOGIN_SUCCESS = "auth.login.success"
    LOGIN_FAILURE = "auth.login.failure"
    LOGOUT = "auth.logout"
    TOKEN_GENERATED = "auth.token.generated"
    TOKEN_VALIDATED = "auth.token.validated"
    TOKEN_EXPIRED = "auth.token.expired"
    TOKEN_INVALID = "auth.token.invalid"
    
    # Registration
    USER_REGISTERED = "auth.user.registered"
    
    # Password management
    PASSWORD_RESET_REQUESTED = "auth.password.reset_requested"
    PASSWORD_RESET_COMPLETED = "auth.password.reset_completed"
    PASSWORD_CHANGED = "auth.password.changed"
    
    # Authorization
    PERMISSION_DENIED = "authz.permission.denied"
    ROLE_CHANGED = "authz.role.changed"
    ACCESS_GRANTED = "authz.access.granted"
    
    # Data access
    SENSITIVE_DATA_READ = "data.sensitive.read"
    SENSITIVE_DATA_WRITE = "data.sensitive.write"
    SENSITIVE_DATA_DELETE = "data.sensitive.delete"


def log_audit_event(
    event_type: AuditEventType,
    details: Optional[Dict[str, Any]] = None,
    request: Optional[Request] = None,
    user_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> None:
    """
    Log an audit event.
    
    Args:
        event_type: Type of audit event
        details: Event-specific details
        request: FastAPI request object (optional)
        user_id: User ID (optional, can be extracted from request)
        tenant_id: Tenant ID (optional, can be extracted from request)
    """
    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "eventType": event_type.value,
        "details": details or {},
    }
    
    # Add request context if available
    if request:
        entry["context"] = {
            "ip": request.client.host if request.client else None,
            "userAgent": request.headers.get("user-agent"),
            "method": request.method,
            "path": request.url.path,
            "userId": user_id or getattr(request.state, "user_id", None),
            "tenantId": tenant_id or getattr(request.state, "tenant_id", None),
        }
    
    # Log as JSON
    logger.info(json.dumps(entry))


def log_login_success(user_id: str, email: str, request: Optional[Request] = None) -> None:
    """Log successful login."""
    log_audit_event(
        AuditEventType.LOGIN_SUCCESS,
        {"userId": user_id, "email": email},
        request,
        user_id=user_id,
    )


def log_login_failure(email: str, reason: str, request: Optional[Request] = None) -> None:
    """Log failed login attempt."""
    log_audit_event(
        AuditEventType.LOGIN_FAILURE,
        {"email": email, "reason": reason},
        request,
    )


def log_user_registered(user_id: str, email: str, role: str, request: Optional[Request] = None) -> None:
    """Log user registration."""
    log_audit_event(
        AuditEventType.USER_REGISTERED,
        {"userId": user_id, "email": email, "role": role},
        request,
        user_id=user_id,
    )


def log_password_reset_requested(email: str, request: Optional[Request] = None) -> None:
    """Log password reset request."""
    log_audit_event(
        AuditEventType.PASSWORD_RESET_REQUESTED,
        {"email": email},
        request,
    )


def log_password_reset_completed(user_id: str, email: str, request: Optional[Request] = None) -> None:
    """Log password reset completion."""
    log_audit_event(
        AuditEventType.PASSWORD_RESET_COMPLETED,
        {"userId": user_id, "email": email},
        request,
        user_id=user_id,
    )


def log_token_generated(user_id: str, email: str, expires_at: str, request: Optional[Request] = None) -> None:
    """Log JWT token generation."""
    log_audit_event(
        AuditEventType.TOKEN_GENERATED,
        {"userId": user_id, "email": email, "expiresAt": expires_at},
        request,
        user_id=user_id,
    )


def log_permission_denied(resource: str, action: str, reason: str, request: Optional[Request] = None) -> None:
    """Log permission denial."""
    log_audit_event(
        AuditEventType.PERMISSION_DENIED,
        {"resource": resource, "action": action, "reason": reason},
        request,
    )
