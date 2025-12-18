"""
Usage tracking for billing and quota management.
Tracks device counts, API calls, and storage usage per tenant.
"""

import logging
from typing import Dict, Optional
from datetime import datetime, timedelta
import redis
import json

logger = logging.getLogger(__name__)


class UsageTracker:
    """
    Tracks usage metrics for billing purposes.
    
    Uses Redis for real-time counters and PostgreSQL for historical data.
    """
    
    def __init__(self, redis_client: Optional[redis.Redis] = None):
        """
        Initialize usage tracker.
        
        Args:
            redis_client: Redis client instance (optional, will create if not provided)
        """
        self.redis = redis_client or redis.Redis(
            host=os.getenv("REDIS_HOST", "localhost"),
            port=int(os.getenv("REDIS_PORT", 6379)),
            decode_responses=True
        )
        logger.info(" UsageTracker initialized")
    
    def track_api_call(self, tenant_id: str, endpoint: str) -> None:
        """
        Track an API call for a tenant.
        
        Args:
            tenant_id: Tenant identifier
            endpoint: API endpoint called
        """
        try:
            today = datetime.utcnow().date().isoformat()
            
            # Increment daily counter
            key = f"usage:api_calls:{tenant_id}:{today}"
            self.redis.incr(key)
            self.redis.expire(key, 86400 * 7)  # Keep for 7 days
            
            # Track endpoint-specific calls
            endpoint_key = f"usage:endpoints:{tenant_id}:{today}:{endpoint}"
            self.redis.incr(endpoint_key)
            self.redis.expire(endpoint_key, 86400 * 7)
            
        except Exception as e:
            logger.error(f" Error tracking API call: {e}")
    
    def get_api_calls(self, tenant_id: str, date: Optional[str] = None) -> int:
        """
        Get API call count for a tenant on a specific date.
        
        Args:
            tenant_id: Tenant identifier
            date: Date in ISO format (defaults to today)
            
        Returns:
            Number of API calls
        """
        try:
            date = date or datetime.utcnow().date().isoformat()
            key = f"usage:api_calls:{tenant_id}:{date}"
            count = self.redis.get(key)
            return int(count) if count else 0
        except Exception as e:
            logger.error(f" Error getting API calls: {e}")
            return 0
    
    def get_device_count(self, tenant_id: str) -> int:
        """
        Get device count for a tenant.
        
        Args:
            tenant_id: Tenant identifier
            
        Returns:
            Number of devices
        """
        try:
            # This would query the actual device database
            # For now, return a placeholder
            key = f"usage:devices:{tenant_id}"
            count = self.redis.get(key)
            return int(count) if count else 0
        except Exception as e:
            logger.error(f" Error getting device count: {e}")
            return 0
    
    def set_device_count(self, tenant_id: str, count: int) -> None:
        """
        Update device count for a tenant.
        
        Args:
            tenant_id: Tenant identifier
            count: Number of devices
        """
        try:
            key = f"usage:devices:{tenant_id}"
            self.redis.set(key, count)
        except Exception as e:
            logger.error(f" Error setting device count: {e}")
    
    def get_storage_usage(self, tenant_id: str) -> float:
        """
        Get storage usage in GB for a tenant.
        
        Args:
            tenant_id: Tenant identifier
            
        Returns:
            Storage usage in GB
        """
        try:
            # This would sum up actual file sizes
            # For now, return a placeholder
            key = f"usage:storage:{tenant_id}"
            storage = self.redis.get(key)
            return float(storage) if storage else 0.0
        except Exception as e:
            logger.error(f" Error getting storage usage: {e}")
            return 0.0
    
    def calculate_overage(self, tenant_id: str, plan_id: str, 
                         square_client) -> Dict[str, any]:
        """
        Calculate usage overage charges.
        
        Args:
            tenant_id: Tenant identifier
            plan_id: Subscription plan ID (starter, pro, enterprise)
            square_client: SquareClient instance
            
        Returns:
            Dict with overage details and charges
        """
        try:
            from .square_client import SquareClient
            
            plan = SquareClient.get_plan(plan_id)
            if not plan:
                raise ValueError(f"Invalid plan_id: {plan_id}")
            
            # Get current usage
            devices = self.get_device_count(tenant_id)
            api_calls = self.get_api_calls(tenant_id)
            storage_gb = self.get_storage_usage(tenant_id)
            
            # Calculate overages
            overages = {
                "devices": max(0, devices - plan["limits"]["devices"]),
                "api_calls": max(0, api_calls - plan["limits"]["api_calls_per_day"]),
                "storage_gb": max(0, storage_gb - plan["limits"]["storage_gb"])
            }
            
            # Calculate charges (in cents)
            charges = {
                "devices": overages["devices"] * plan["overage_rates"]["device"],
                "api_calls": (overages["api_calls"] // 1000) * plan["overage_rates"]["api_calls_1000"],
                "storage": int(overages["storage_gb"]) * plan["overage_rates"]["storage_gb"]
            }
            
            total_overage_charge = sum(charges.values())
            
            return {
                "tenant_id": tenant_id,
                "plan_id": plan_id,
                "usage": {
                    "devices": devices,
                    "api_calls": api_calls,
                    "storage_gb": storage_gb
                },
                "limits": plan["limits"],
                "overages": overages,
                "charges": charges,
                "total_overage_charge": total_overage_charge,
                "total_overage_charge_usd": f"${total_overage_charge / 100:.2f}"
            }
            
        except Exception as e:
            logger.error(f" Error calculating overage: {e}")
            raise
    
    def get_usage_summary(self, tenant_id: str, days: int = 30) -> Dict:
        """
        Get usage summary for the last N days.
        
        Args:
            tenant_id: Tenant identifier
            days: Number of days to summarize
            
        Returns:
            Dict with usage summary
        """
        try:
            api_calls_total = 0
            daily_usage = []
            
            for i in range(days):
                date = (datetime.utcnow() - timedelta(days=i)).date().isoformat()
                api_calls = self.get_api_calls(tenant_id, date)
                api_calls_total += api_calls
                
                daily_usage.append({
                    "date": date,
                    "api_calls": api_calls
                })
            
            return {
                "tenant_id": tenant_id,
                "period_days": days,
                "devices": self.get_device_count(tenant_id),
                "api_calls_total": api_calls_total,
                "api_calls_avg_per_day": api_calls_total // days if days > 0 else 0,
                "storage_gb": self.get_storage_usage(tenant_id),
                "daily_usage": daily_usage[:7]  # Return last 7 days for chart
            }
            
        except Exception as e:
            logger.error(f" Error getting usage summary: {e}")
            return {}


# Add missing import
import os
