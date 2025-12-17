"""
Email templates for Light Engine.

All templates return EmailTemplate objects with subject, html_body, and text_body.
"""

from typing import Optional
from .email_service import EmailTemplate


def get_password_reset_template(
    user_name: str,
    reset_url: str,
    expiration_hours: int = 1
) -> EmailTemplate:
    """
    Password reset email template.
    
    Args:
        user_name: User's full name
        reset_url: Password reset URL with token
        expiration_hours: Hours until token expires
    
    Returns:
        EmailTemplate with formatted email content
    """
    subject = "Reset Your Light Engine Password"
    
    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px;">🌱 Light Engine</h1>
    </div>
    
    <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #111827; margin-top: 0;">Password Reset Request</h2>
        
        <p>Hello {user_name},</p>
        
        <p>We received a request to reset your Light Engine password. Click the button below to create a new password:</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{reset_url}" style="background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Reset Password</a>
        </div>
        
        <p style="color: #6b7280; font-size: 14px;">This link will expire in {expiration_hours} hour{"s" if expiration_hours != 1 else ""}.</p>
        
        <p>If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.</p>
        
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
        
        <p style="color: #6b7280; font-size: 13px;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="{reset_url}" style="color: #10b981; word-break: break-all;">{reset_url}</a>
        </p>
        
        <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
            This email was sent by Light Engine, an indoor farming automation platform.<br>
            Questions? Contact us at support@lightengine.io
        </p>
    </div>
</body>
</html>
"""
    
    text_body = f"""
Light Engine - Password Reset Request

Hello {user_name},

We received a request to reset your Light Engine password.

To reset your password, visit this link:
{reset_url}

This link will expire in {expiration_hours} hour{"s" if expiration_hours != 1 else ""}.

If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.

---
This email was sent by Light Engine, an indoor farming automation platform.
Questions? Contact us at support@lightengine.io
"""
    
    return EmailTemplate(subject=subject, html_body=html_body, text_body=text_body)


def get_welcome_template(
    user_name: str,
    login_url: str = "https://app.lightengine.io/login"
) -> EmailTemplate:
    """
    Welcome email template for new users.
    
    Args:
        user_name: User's full name
        login_url: URL to login page
    
    Returns:
        EmailTemplate with formatted email content
    """
    subject = "Welcome to Light Engine! 🌱"
    
    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px;">🌱 Light Engine</h1>
        <p style="color: #d1fae5; margin: 10px 0 0 0;">Indoor Farming Automation</p>
    </div>
    
    <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #111827; margin-top: 0;">Welcome aboard! 🎉</h2>
        
        <p>Hello {user_name},</p>
        
        <p>Thank you for joining Light Engine! We're excited to help you automate and optimize your indoor farming operations.</p>
        
        <div style="background: #f3f4f6; padding: 20px; border-radius: 6px; margin: 25px 0;">
            <h3 style="color: #111827; margin-top: 0; font-size: 18px;">🚀 Get Started</h3>
            <ul style="margin: 10px 0; padding-left: 20px;">
                <li style="margin: 8px 0;">Connect your grow lights and environmental sensors</li>
                <li style="margin: 8px 0;">Set up automation rules for optimal plant growth</li>
                <li style="margin: 8px 0;">Monitor real-time environmental data</li>
                <li style="margin: 8px 0;">Track energy usage and optimize costs</li>
            </ul>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{login_url}" style="background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Go to Dashboard</a>
        </div>
        
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
        
        <h3 style="color: #111827; font-size: 18px;">📚 Resources</h3>
        <ul style="margin: 10px 0; padding-left: 20px;">
            <li style="margin: 8px 0;"><a href="https://docs.lightengine.io" style="color: #10b981;">Documentation</a></li>
            <li style="margin: 8px 0;"><a href="https://docs.lightengine.io/quick-start" style="color: #10b981;">Quick Start Guide</a></li>
            <li style="margin: 8px 0;"><a href="https://community.lightengine.io" style="color: #10b981;">Community Forum</a></li>
        </ul>
        
        <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
            Need help? Reply to this email or contact us at support@lightengine.io
        </p>
    </div>
</body>
</html>
"""
    
    text_body = f"""
Welcome to Light Engine! 🌱

Hello {user_name},

Thank you for joining Light Engine! We're excited to help you automate and optimize your indoor farming operations.

GET STARTED:
• Connect your grow lights and environmental sensors
• Set up automation rules for optimal plant growth
• Monitor real-time environmental data
• Track energy usage and optimize costs

Go to Dashboard: {login_url}

RESOURCES:
• Documentation: https://docs.lightengine.io
• Quick Start Guide: https://docs.lightengine.io/quick-start
• Community Forum: https://community.lightengine.io

---
Need help? Reply to this email or contact us at support@lightengine.io
"""
    
    return EmailTemplate(subject=subject, html_body=html_body, text_body=text_body)


def get_email_verification_template(
    user_name: str,
    verification_url: str,
    expiration_hours: int = 24
) -> EmailTemplate:
    """
    Email verification template.
    
    Args:
        user_name: User's full name
        verification_url: Email verification URL with token
        expiration_hours: Hours until token expires
    
    Returns:
        EmailTemplate with formatted email content
    """
    subject = "Verify Your Light Engine Email Address"
    
    html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px;">🌱 Light Engine</h1>
    </div>
    
    <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #111827; margin-top: 0;">Verify Your Email Address</h2>
        
        <p>Hello {user_name},</p>
        
        <p>Thank you for creating a Light Engine account! Please verify your email address by clicking the button below:</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{verification_url}" style="background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Verify Email Address</a>
        </div>
        
        <p style="color: #6b7280; font-size: 14px;">This link will expire in {expiration_hours} hours.</p>
        
        <p>If you didn't create a Light Engine account, you can safely ignore this email.</p>
        
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
        
        <p style="color: #6b7280; font-size: 13px;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="{verification_url}" style="color: #10b981; word-break: break-all;">{verification_url}</a>
        </p>
        
        <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
            This email was sent by Light Engine, an indoor farming automation platform.<br>
            Questions? Contact us at support@lightengine.io
        </p>
    </div>
</body>
</html>
"""
    
    text_body = f"""
Light Engine - Verify Your Email Address

Hello {user_name},

Thank you for creating a Light Engine account! Please verify your email address by visiting this link:
{verification_url}

This link will expire in {expiration_hours} hours.

If you didn't create a Light Engine account, you can safely ignore this email.

---
This email was sent by Light Engine, an indoor farming automation platform.
Questions? Contact us at support@lightengine.io
"""
    
    return EmailTemplate(subject=subject, html_body=html_body, text_body=text_body)
