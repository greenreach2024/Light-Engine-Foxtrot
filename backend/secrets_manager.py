"""
AWS Secrets Manager Integration for Light Engine Foxtrot

Provides secure retrieval of JWT secrets from AWS Secrets Manager with caching.
Falls back to environment variables for local development.
"""

import os
import logging
from datetime import datetime, timedelta
from typing import Optional

try:
    import boto3
    from botocore.exceptions import ClientError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    logging.warning("boto3 not installed - AWS Secrets Manager integration disabled")

logger = logging.getLogger(__name__)

# Cache configuration
_secrets_cache = {}
_cache_ttl = timedelta(hours=1)


class SecretsManagerClient:
    """Client for AWS Secrets Manager with caching."""
    
    def __init__(self):
        """Initialize Secrets Manager client."""
        self.client = None
        if BOTO3_AVAILABLE:
            region = os.getenv("AWS_REGION", "us-east-1")
            try:
                self.client = boto3.client("secretsmanager", region_name=region)
                logger.info(f"Initialized Secrets Manager client for region {region}")
            except Exception as e:
                logger.error(f"Failed to initialize Secrets Manager client: {e}")
        else:
            logger.warning("Secrets Manager client not available - using env vars only")
    
    def get_secret(self, secret_id: str) -> Optional[str]:
        """
        Retrieve a secret from AWS Secrets Manager with caching.
        
        Args:
            secret_id: The name or ARN of the secret
            
        Returns:
            The secret string value, or None if not found
        """
        # Check cache first
        cache_key = secret_id
        if cache_key in _secrets_cache:
            cached_value, cached_time = _secrets_cache[cache_key]
            if datetime.now() - cached_time < _cache_ttl:
                logger.debug(f"Using cached secret: {secret_id}")
                return cached_value
            else:
                logger.debug(f"Cache expired for secret: {secret_id}")
                del _secrets_cache[cache_key]
        
        # Fetch from Secrets Manager
        if not self.client:
            logger.warning("Secrets Manager client not available")
            return None
        
        try:
            logger.info(f"Fetching secret from AWS Secrets Manager: {secret_id}")
            response = self.client.get_secret_value(SecretId=secret_id)
            
            secret_value = response.get("SecretString")
            if secret_value:
                # Cache the secret
                _secrets_cache[cache_key] = (secret_value, datetime.now())
                logger.info(f"Successfully retrieved and cached secret: {secret_id}")
                return secret_value
            else:
                logger.error(f"Secret has no string value: {secret_id}")
                return None
                
        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            if error_code == "ResourceNotFoundException":
                logger.error(f"Secret not found: {secret_id}")
            elif error_code == "AccessDeniedException":
                logger.error(f"Access denied to secret: {secret_id}")
            else:
                logger.error(f"Error fetching secret {secret_id}: {error_code} - {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error fetching secret {secret_id}: {e}")
            return None
    
    def get_jwt_secret(self) -> str:
        """
        Get JWT signing secret from Secrets Manager or environment variable.
        
        Priority:
        1. AWS Secrets Manager (if JWT_SECRET_ARN is set)
        2. Environment variable JWT_SECRET
        3. Raises error if neither is available
        
        Returns:
            JWT secret string
            
        Raises:
            ValueError: If no JWT secret is configured
        """
        # Try Secrets Manager first
        secret_arn = os.getenv("JWT_SECRET_ARN")
        if secret_arn:
            logger.info(f"Attempting to load JWT secret from Secrets Manager: {secret_arn}")
            secret = self.get_secret(secret_arn)
            if secret:
                logger.info("✅ JWT secret loaded from AWS Secrets Manager")
                return secret
            else:
                logger.warning("Failed to load JWT secret from Secrets Manager, falling back to env var")
        
        # Fall back to environment variable
        jwt_secret = os.getenv("JWT_SECRET")
        if jwt_secret:
            if jwt_secret == "CHANGE_ME_IN_PRODUCTION":
                logger.warning("⚠️ Using default JWT_SECRET - THIS IS INSECURE FOR PRODUCTION!")
                logger.warning("⚠️ Set JWT_SECRET_ARN to use AWS Secrets Manager")
            else:
                logger.info("Using JWT secret from JWT_SECRET environment variable")
            return jwt_secret
        
        # No secret configured
        error_msg = (
            "No JWT secret configured. Set either:\n"
            "  - JWT_SECRET_ARN (recommended for production)\n"
            "  - JWT_SECRET (for local development)"
        )
        logger.error(error_msg)
        raise ValueError(error_msg)
    
    def clear_cache(self):
        """Clear the secrets cache."""
        global _secrets_cache
        _secrets_cache = {}
        logger.info("Secrets cache cleared")


# Global instance
_secrets_client = None


def get_secrets_client() -> SecretsManagerClient:
    """Get or create the global Secrets Manager client."""
    global _secrets_client
    if _secrets_client is None:
        _secrets_client = SecretsManagerClient()
    return _secrets_client


def get_jwt_secret() -> str:
    """
    Convenience function to get JWT secret.
    
    Returns:
        JWT secret string
        
    Raises:
        ValueError: If no JWT secret is configured
    """
    return get_secrets_client().get_jwt_secret()


def clear_secrets_cache():
    """Convenience function to clear secrets cache."""
    get_secrets_client().clear_cache()
