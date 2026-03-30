"""
Email service for Light Engine authentication and notifications.
"""

from .email_service import EmailService, EmailTemplate
from .templates import (
    get_password_reset_template,
    get_welcome_template,
    get_email_verification_template,
)

__all__ = [
    "EmailService",
    "EmailTemplate",
    "get_password_reset_template",
    "get_welcome_template",
    "get_email_verification_template",
]
