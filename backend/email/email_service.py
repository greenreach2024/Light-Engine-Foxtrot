"""
Email service with AWS SES and SendGrid support.

Supports two email providers:
1. AWS SES (default, recommended for cost)
2. SendGrid (alternative, easier setup)

Configuration via environment variables:
- EMAIL_PROVIDER: "ses" or "sendgrid" (default: "ses")
- EMAIL_FROM: Sender email address (e.g., "noreply@lightengine.io")
- EMAIL_FROM_NAME: Sender name (e.g., "Light Engine")

For AWS SES:
- AWS_REGION: AWS region (e.g., "us-east-1")
- AWS credentials configured via ~/.aws/credentials or environment variables

For SendGrid:
- SENDGRID_API_KEY: SendGrid API key

Usage:
    from backend.email import EmailService, get_password_reset_template
    
    email_service = EmailService()
    template = get_password_reset_template(
        user_name="John Doe",
        reset_url="https://app.lightengine.io/reset-password?token=abc123"
    )
    
    email_service.send_email(
        to_email="user@example.com",
        subject=template.subject,
        html_body=template.html_body,
        text_body=template.text_body
    )
"""

import os
import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class EmailTemplate:
    """Email template with subject and body."""
    subject: str
    html_body: str
    text_body: str


class EmailService:
    """
    Email service with multiple provider support.
    
    Automatically selects provider based on EMAIL_PROVIDER environment variable.
    Falls back to console logging if no provider is configured.
    """
    
    def __init__(self):
        """Initialize email service with configured provider."""
        self.provider = os.getenv("EMAIL_PROVIDER", "ses").lower()
        self.from_email = os.getenv("EMAIL_FROM", "noreply@lightengine.io")
        self.from_name = os.getenv("EMAIL_FROM_NAME", "Light Engine")
        self.enabled = os.getenv("EMAIL_ENABLED", "false").lower() == "true"
        
        if not self.enabled:
            logger.info("📧 Email service DISABLED - emails will be logged to console")
            return
        
        if self.provider == "ses":
            self._init_ses()
        elif self.provider == "sendgrid":
            self._init_sendgrid()
        else:
            logger.warning(f"Unknown email provider: {self.provider}. Emails will be logged to console.")
            self.enabled = False
    
    def _init_ses(self):
        """Initialize AWS SES client."""
        try:
            import boto3
            from botocore.exceptions import ClientError
            
            region = os.getenv("AWS_REGION", "us-east-1")
            self.ses_client = boto3.client("ses", region_name=region)
            
            # Verify SES is accessible
            self.ses_client.get_send_quota()
            logger.info(f"✅ AWS SES email service initialized (region: {region})")
            
        except ImportError:
            logger.error("❌ boto3 not installed. Install with: pip install boto3")
            self.enabled = False
        except Exception as e:
            logger.error(f"❌ Failed to initialize AWS SES: {e}")
            self.enabled = False
    
    def _init_sendgrid(self):
        """Initialize SendGrid client."""
        try:
            from sendgrid import SendGridAPIClient
            
            api_key = os.getenv("SENDGRID_API_KEY")
            if not api_key:
                raise ValueError("SENDGRID_API_KEY environment variable not set")
            
            self.sendgrid_client = SendGridAPIClient(api_key)
            logger.info("✅ SendGrid email service initialized")
            
        except ImportError:
            logger.error("❌ sendgrid not installed. Install with: pip install sendgrid")
            self.enabled = False
        except Exception as e:
            logger.error(f"❌ Failed to initialize SendGrid: {e}")
            self.enabled = False
    
    def send_email(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
        reply_to: Optional[str] = None,
        **kwargs
    ) -> bool:
        """
        Send email via configured provider.
        
        Args:
            to_email: Recipient email address
            subject: Email subject line
            html_body: HTML email body
            text_body: Plain text email body (fallback)
            reply_to: Reply-to email address
            **kwargs: Additional provider-specific parameters
        
        Returns:
            True if email sent successfully, False otherwise
        """
        if not self.enabled:
            logger.info(f"""
📧 EMAIL (Console Mode - EMAIL_ENABLED=false)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To: {to_email}
From: {self.from_name} <{self.from_email}>
Subject: {subject}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{text_body or html_body}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""")
            return True
        
        try:
            if self.provider == "ses":
                return self._send_via_ses(to_email, subject, html_body, text_body, reply_to)
            elif self.provider == "sendgrid":
                return self._send_via_sendgrid(to_email, subject, html_body, text_body, reply_to)
            else:
                logger.error(f"No email provider configured")
                return False
                
        except Exception as e:
            logger.error(f"❌ Failed to send email to {to_email}: {e}")
            return False
    
    def _send_via_ses(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str],
        reply_to: Optional[str]
    ) -> bool:
        """Send email via AWS SES."""
        try:
            from botocore.exceptions import ClientError
            
            message = {
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {}
            }
            
            if html_body:
                message["Body"]["Html"] = {"Data": html_body, "Charset": "UTF-8"}
            
            if text_body:
                message["Body"]["Text"] = {"Data": text_body, "Charset": "UTF-8"}
            
            send_params = {
                "Source": f"{self.from_name} <{self.from_email}>",
                "Destination": {"ToAddresses": [to_email]},
                "Message": message,
            }
            
            if reply_to:
                send_params["ReplyToAddresses"] = [reply_to]
            
            response = self.ses_client.send_email(**send_params)
            logger.info(f"✅ Email sent via SES to {to_email} (MessageId: {response['MessageId']})")
            return True
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'MessageRejected':
                logger.error(f"❌ SES rejected email to {to_email}: {e.response['Error']['Message']}")
            elif error_code == 'MailFromDomainNotVerifiedException':
                logger.error(f"❌ SES sender domain not verified: {self.from_email}")
            else:
                logger.error(f"❌ SES error sending to {to_email}: {e}")
            return False
    
    def _send_via_sendgrid(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str],
        reply_to: Optional[str]
    ) -> bool:
        """Send email via SendGrid."""
        try:
            from sendgrid.helpers.mail import Mail, Email, To, Content
            
            from_email = Email(self.from_email, self.from_name)
            to_email_obj = To(to_email)
            
            mail = Mail(
                from_email=from_email,
                to_emails=to_email_obj,
                subject=subject,
            )
            
            if text_body:
                mail.add_content(Content("text/plain", text_body))
            
            if html_body:
                mail.add_content(Content("text/html", html_body))
            
            if reply_to:
                mail.reply_to = Email(reply_to)
            
            response = self.sendgrid_client.send(mail)
            logger.info(f"✅ Email sent via SendGrid to {to_email} (status: {response.status_code})")
            return True
            
        except Exception as e:
            logger.error(f"❌ SendGrid error sending to {to_email}: {e}")
            return False
    
    def verify_sender_email(self, email: str) -> bool:
        """
        Verify sender email address with provider.
        
        For AWS SES: Initiates verification process
        For SendGrid: Verifies sender identity
        
        Args:
            email: Email address to verify
        
        Returns:
            True if verification initiated/successful
        """
        if not self.enabled:
            logger.info(f"📧 Email disabled - skipping verification for {email}")
            return False
        
        try:
            if self.provider == "ses":
                self.ses_client.verify_email_identity(EmailAddress=email)
                logger.info(f"✅ SES verification email sent to {email}")
                return True
            elif self.provider == "sendgrid":
                logger.info("⚠️  SendGrid verification must be done via dashboard")
                logger.info("   Visit: https://app.sendgrid.com/settings/sender_auth")
                return False
            else:
                return False
                
        except Exception as e:
            logger.error(f"❌ Failed to verify sender email {email}: {e}")
            return False
