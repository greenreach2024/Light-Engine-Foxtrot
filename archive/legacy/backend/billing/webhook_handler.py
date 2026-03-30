"""
Webhook handler for Square payment events.
Processes subscription lifecycle events and payment notifications.
"""

import os
import hmac
import hashlib
import logging
from typing import Dict, Optional, Any
from datetime import datetime
import json

logger = logging.getLogger(__name__)


class WebhookHandler:
    """
    Handles Square webhook events.
    
    Verifies signatures and processes subscription and payment events.
    """
    
    def __init__(self, signature_key: Optional[str] = None):
        """
        Initialize webhook handler.
        
        Args:
            signature_key: Square webhook signature key (from Square Dashboard)
        """
        self.signature_key = signature_key or os.getenv("SQUARE_WEBHOOK_SIGNATURE_KEY")
        if not self.signature_key:
            logger.warning(" No Square webhook signature key configured")
        
        logger.info(" WebhookHandler initialized")
    
    def verify_signature(self, payload: str, signature: str, 
                        notification_url: str) -> bool:
        """
        Verify Square webhook signature using HMAC-SHA256.
        
        Args:
            payload: Raw webhook payload (JSON string)
            signature: X-Square-Signature header value
            notification_url: Your webhook URL
            
        Returns:
            True if signature is valid
        """
        try:
            if not self.signature_key:
                logger.warning(" Signature verification skipped (no key configured)")
                return True  # Skip verification in dev mode
            
            # Square concatenates: notification_url + request_body
            string_to_sign = notification_url + payload
            
            # Calculate HMAC-SHA256
            hmac_digest = hmac.new(
                self.signature_key.encode('utf-8'),
                string_to_sign.encode('utf-8'),
                hashlib.sha256
            ).digest()
            
            # Base64 encode
            import base64
            expected_signature = base64.b64encode(hmac_digest).decode('utf-8')
            
            is_valid = hmac.compare_digest(expected_signature, signature)
            
            if not is_valid:
                logger.error(f" Invalid webhook signature")
            
            return is_valid
            
        except Exception as e:
            logger.error(f" Error verifying signature: {e}")
            return False
    
    def handle_webhook(self, event_type: str, event_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Route webhook event to appropriate handler.
        
        Args:
            event_type: Event type (e.g., "subscription.created")
            event_data: Event payload data
            
        Returns:
            Dict with processing result
        """
        try:
            logger.info(f"📨 Received webhook: {event_type}")
            
            handlers = {
                "subscription.created": self.handle_subscription_created,
                "subscription.updated": self.handle_subscription_updated,
                "subscription.canceled": self.handle_subscription_canceled,
                "payment.created": self.handle_payment_created,
                "payment.updated": self.handle_payment_updated,
            }
            
            handler = handlers.get(event_type)
            if handler:
                return handler(event_data)
            else:
                logger.warning(f" Unhandled event type: {event_type}")
                return {"status": "ignored", "event_type": event_type}
                
        except Exception as e:
            logger.error(f" Error handling webhook: {e}")
            return {"status": "error", "error": str(e)}
    
    def handle_subscription_created(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle subscription.created event.
        
        Args:
            data: Subscription data
            
        Returns:
            Processing result
        """
        try:
            subscription = data.get("object", {}).get("subscription", {})
            subscription_id = subscription.get("id")
            customer_id = subscription.get("customer_id")
            plan_id = subscription.get("plan_id")
            status = subscription.get("status")
            
            logger.info(f" Subscription created: {subscription_id} (customer: {customer_id})")
            
            # TODO: Update database with subscription details
            # - Create subscription record
            # - Update tenant with active subscription
            # - Send welcome email
            
            return {
                "status": "processed",
                "subscription_id": subscription_id,
                "action": "subscription_activated"
            }
            
        except Exception as e:
            logger.error(f" Error handling subscription.created: {e}")
            raise
    
    def handle_subscription_updated(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle subscription.updated event.
        
        Args:
            data: Subscription data
            
        Returns:
            Processing result
        """
        try:
            subscription = data.get("object", {}).get("subscription", {})
            subscription_id = subscription.get("id")
            status = subscription.get("status")
            
            logger.info(f" Subscription updated: {subscription_id} (status: {status})")
            
            # TODO: Update database with new subscription status
            # - Update subscription record
            # - Handle plan changes
            # - Handle pause/resume
            
            return {
                "status": "processed",
                "subscription_id": subscription_id,
                "action": "subscription_updated"
            }
            
        except Exception as e:
            logger.error(f" Error handling subscription.updated: {e}")
            raise
    
    def handle_subscription_canceled(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle subscription.canceled event.
        
        Args:
            data: Subscription data
            
        Returns:
            Processing result
        """
        try:
            subscription = data.get("object", {}).get("subscription", {})
            subscription_id = subscription.get("id")
            customer_id = subscription.get("customer_id")
            
            logger.warning(f" Subscription canceled: {subscription_id}")
            
            # TODO: Handle subscription cancellation
            # - Update subscription status to "canceled"
            # - Schedule account downgrade/deactivation
            # - Send cancellation confirmation email
            # - Retain data for grace period
            
            return {
                "status": "processed",
                "subscription_id": subscription_id,
                "action": "subscription_canceled"
            }
            
        except Exception as e:
            logger.error(f" Error handling subscription.canceled: {e}")
            raise
    
    def handle_payment_created(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle payment.created event.
        
        Args:
            data: Payment data
            
        Returns:
            Processing result
        """
        try:
            payment = data.get("object", {}).get("payment", {})
            payment_id = payment.get("id")
            amount = payment.get("amount_money", {}).get("amount", 0)
            status = payment.get("status")
            customer_id = payment.get("customer_id")
            
            logger.info(f" Payment created: {payment_id} (${amount/100:.2f}, status: {status})")
            
            # TODO: Record payment in database
            # - Create payment record
            # - Update invoice status
            
            return {
                "status": "processed",
                "payment_id": payment_id,
                "action": "payment_recorded"
            }
            
        except Exception as e:
            logger.error(f" Error handling payment.created: {e}")
            raise
    
    def handle_payment_updated(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle payment.updated event (completed or failed).
        
        Args:
            data: Payment data
            
        Returns:
            Processing result
        """
        try:
            payment = data.get("object", {}).get("payment", {})
            payment_id = payment.get("id")
            status = payment.get("status")
            amount = payment.get("amount_money", {}).get("amount", 0)
            
            if status == "COMPLETED":
                logger.info(f" Payment succeeded: {payment_id} (${amount/100:.2f})")
                
                # TODO: Process successful payment
                # - Mark invoice as paid
                # - Send receipt email
                # - Extend subscription period
                
                action = "payment_succeeded"
                
            elif status == "FAILED":
                logger.error(f" Payment failed: {payment_id}")
                
                # TODO: Handle failed payment
                # - Retry payment (up to 3 times)
                # - Send payment failed email
                # - Suspend account after grace period
                
                action = "payment_failed"
                
            else:
                logger.info(f"ℹ Payment status: {status}")
                action = f"payment_status_{status.lower()}"
            
            return {
                "status": "processed",
                "payment_id": payment_id,
                "payment_status": status,
                "action": action
            }
            
        except Exception as e:
            logger.error(f" Error handling payment.updated: {e}")
            raise
