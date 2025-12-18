"""
Square API client for payment processing and subscription management.
"""

import os
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
from square.client import Client
from square.http.auth.o_auth_2 import BearerAuthCredentials

logger = logging.getLogger(__name__)


class SquareClient:
    """
    Wrapper for Square API operations.
    
    Handles customer management, subscription creation, and payment processing.
    """
    
    # Subscription plan definitions
    PLANS = {
        "starter": {
            "name": "Starter",
            "price": 4900,  # $49.00 in cents
            "currency": "USD",
            "interval": "MONTHLY",
            "limits": {
                "devices": 10,
                "api_calls_per_day": 1000,
                "storage_gb": 5
            },
            "overage_rates": {
                "device": 500,  # $5.00 per extra device
                "api_calls_1000": 100,  # $1.00 per 1000 extra API calls
                "storage_gb": 200  # $2.00 per extra GB
            }
        },
        "pro": {
            "name": "Pro",
            "price": 19900,  # $199.00 in cents
            "currency": "USD",
            "interval": "MONTHLY",
            "limits": {
                "devices": 50,
                "api_calls_per_day": 10000,
                "storage_gb": 50
            },
            "overage_rates": {
                "device": 400,  # $4.00 per extra device
                "api_calls_1000": 75,  # $0.75 per 1000 extra API calls
                "storage_gb": 150  # $1.50 per extra GB
            }
        },
        "enterprise": {
            "name": "Enterprise",
            "price": 99900,  # $999.00 in cents
            "currency": "USD",
            "interval": "MONTHLY",
            "limits": {
                "devices": 500,
                "api_calls_per_day": 100000,
                "storage_gb": 500
            },
            "overage_rates": {
                "device": 300,  # $3.00 per extra device
                "api_calls_1000": 50,  # $0.50 per 1000 extra API calls
                "storage_gb": 100  # $1.00 per extra GB
            }
        }
    }
    
    def __init__(self, access_token: Optional[str] = None, environment: str = "sandbox"):
        """
        Initialize Square client.
        
        Args:
            access_token: Square access token (defaults to env var SQUARE_ACCESS_TOKEN)
            environment: "sandbox" or "production"
        """
        self.access_token = access_token or os.getenv("SQUARE_ACCESS_TOKEN")
        if not self.access_token:
            raise ValueError("Square access token is required (SQUARE_ACCESS_TOKEN env var)")
        
        self.environment = environment
        
        # Initialize Square client with bearer token authentication
        self.client = Client(
            bearer_auth_credentials=BearerAuthCredentials(
                access_token=self.access_token
            ),
            environment=environment  # 'sandbox' or 'production'
        )
        
        logger.info(f" Square client initialized (environment: {environment})")
    
    def create_customer(self, email: str, first_name: str, last_name: str, 
                       tenant_id: str, metadata: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Create a Square customer.
        
        Args:
            email: Customer email address
            first_name: Customer first name
            last_name: Customer last name
            tenant_id: Internal tenant ID
            metadata: Additional customer metadata
            
        Returns:
            Dict containing success status, customer_id and customer details
        """
        try:
            result = self.client.customers.create(
                email_address=email,
                given_name=first_name,
                family_name=last_name,
                reference_id=tenant_id,  # Link Square customer to our tenant
                note=f"Light Engine customer (tenant: {tenant_id})"
            )
            
            if result.customer:
                customer = result.customer
                logger.info(f" Created Square customer: {customer.id} for {email}")
                return {
                    "success": True,
                    "customer_id": customer.id,
                    "email": email,
                    "tenant_id": tenant_id,
                    "created_at": customer.created_at,
                    "customer": customer.dict() if hasattr(customer, 'dict') else {}
                }
            elif result.errors:
                logger.error(f" Square API error creating customer: {result.errors}")
                return {
                    "success": False,
                    "error": str(result.errors)
                }
                
        except Exception as e:
            logger.error(f" Error creating Square customer: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def create_subscription(self, customer_id: str, plan_id: str, 
                          card_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Create a subscription for a customer.
        
        Args:
            customer_id: Square customer ID
            plan_id: Plan identifier (starter, pro, enterprise)
            card_id: Square card ID for payment method
            
        Returns:
            Dict containing subscription details
        """
        try:
            if plan_id not in self.PLANS:
                raise ValueError(f"Invalid plan_id: {plan_id}. Must be one of {list(self.PLANS.keys())}")
            
            plan = self.PLANS[plan_id]
            
            # Note: Square Subscriptions require a catalog subscription plan to be created first
            # For now, we'll create a basic subscription structure
            # In production, you would reference a catalog_object_id
            
            body = {
                "idempotency_key": f"{customer_id}-{plan_id}-{datetime.utcnow().isoformat()}",
                "location_id": os.getenv("SQUARE_LOCATION_ID"),  # Your Square location ID
                "plan_id": plan_id,  # This should be a catalog_object_id in production
                "customer_id": customer_id,
                "start_date": datetime.utcnow().date().isoformat(),
                "card_id": card_id,
                "timezone": "America/Los_Angeles"
            }
            
            # TODO: Implement actual Square subscription creation
            # This requires creating catalog items first via Square Dashboard or Catalog API
            logger.warning(" Square subscription creation requires catalog setup")
            
            return {
                "subscription_id": f"sub_{customer_id}_{plan_id}",  # Placeholder
                "customer_id": customer_id,
                "plan": plan,
                "status": "active",
                "created_at": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            logger.error(f" Error creating subscription: {e}")
            raise
    
    def create_payment(self, amount: int, customer_id: str, 
                      card_id: str, note: Optional[str] = None) -> Dict[str, Any]:
        """
        Create a one-time payment.
        
        Args:
            amount: Amount in cents (e.g., 4900 = $49.00)
            customer_id: Square customer ID
            card_id: Square card ID
            note: Payment description
            
        Returns:
            Dict containing payment details
        """
        try:
            body = {
                "source_id": card_id,
                "idempotency_key": f"payment-{customer_id}-{datetime.utcnow().timestamp()}",
                "amount_money": {
                    "amount": amount,
                    "currency": "USD"
                },
                "customer_id": customer_id,
                "note": note or "Light Engine subscription payment"
            }
            
            result = self.client.payments.create_payment(body)
            
            if result.is_success():
                payment = result.body.get("payment", {})
                logger.info(f" Payment successful: {payment.get('id')} (${amount/100:.2f})")
                return {
                    "payment_id": payment.get("id"),
                    "status": payment.get("status"),
                    "amount": amount,
                    "customer_id": customer_id,
                    "created_at": payment.get("created_at")
                }
            elif result.is_error():
                errors = result.errors
                logger.error(f" Payment failed: {errors}")
                raise Exception(f"Payment failed: {errors}")
                
        except Exception as e:
            logger.error(f" Error processing payment: {e}")
            raise
    
    def list_customers(self, limit: int = 100) -> List[Dict[str, Any]]:
        """
        List all customers.
        
        Args:
            limit: Maximum number of customers to return
            
        Returns:
            List of customer dictionaries
        """
        try:
            result = self.client.customers.list_customers(limit=limit)
            
            if result.is_success():
                customers = result.body.get("customers", [])
                logger.info(f" Retrieved {len(customers)} customers")
                return customers
            elif result.is_error():
                errors = result.errors
                logger.error(f" Error listing customers: {errors}")
                return []
                
        except Exception as e:
            logger.error(f" Error listing customers: {e}")
            return []
    
    def get_customer(self, customer_id: str) -> Optional[Dict[str, Any]]:
        """
        Get customer details by ID.
        
        Args:
            customer_id: Square customer ID
            
        Returns:
            Customer dictionary or None
        """
        try:
            result = self.client.customers.retrieve_customer(customer_id)
            
            if result.is_success():
                customer = result.body.get("customer", {})
                return customer
            elif result.is_error():
                logger.error(f" Customer not found: {customer_id}")
                return None
                
        except Exception as e:
            logger.error(f" Error retrieving customer: {e}")
            return None
    
    @staticmethod
    def get_plan(plan_id: str) -> Optional[Dict[str, Any]]:
        """
        Get plan details by ID.
        
        Args:
            plan_id: Plan identifier (starter, pro, enterprise)
            
        Returns:
            Plan dictionary or None
        """
        return SquareClient.PLANS.get(plan_id)
    
    @staticmethod
    def list_plans() -> List[Dict[str, Any]]:
        """
        List all available subscription plans.
        
        Returns:
            List of plan dictionaries with plan_id added
        """
        return [
            {"plan_id": plan_id, **plan_data}
            for plan_id, plan_data in SquareClient.PLANS.items()
        ]
