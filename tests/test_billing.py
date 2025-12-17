"""
Tests for Square billing integration.
"""

import pytest
from unittest.mock import Mock, patch
from backend.billing.square_client import SquareClient
from backend.billing.usage_tracker import UsageTracker
from backend.billing.webhook_handler import WebhookHandler


class TestSquareClient:
    """Tests for SquareClient."""
    
    def test_list_plans(self):
        """Test listing subscription plans."""
        plans = SquareClient.list_plans()
        
        assert len(plans) == 3
        assert plans[0]["plan_id"] == "starter"
        assert plans[1]["plan_id"] == "pro"
        assert plans[2]["plan_id"] == "enterprise"
        
        # Verify starter plan
        starter = plans[0]
        assert starter["name"] == "Starter"
        assert starter["price"] == 4900  # $49.00
        assert starter["limits"]["devices"] == 10
        assert starter["limits"]["api_calls_per_day"] == 1000
    
    def test_get_plan(self):
        """Test getting a specific plan."""
        starter = SquareClient.get_plan("starter")
        
        assert starter is not None
        assert starter["name"] == "Starter"
        assert starter["price"] == 4900
        
        # Test invalid plan
        invalid = SquareClient.get_plan("invalid")
        assert invalid is None
    
    @patch.dict("os.environ", {"SQUARE_ACCESS_TOKEN": "test_token"})
    def test_client_initialization(self):
        """Test Square client initialization."""
        client = SquareClient(environment="sandbox")
        
        assert client.access_token == "test_token"
        assert client.environment == "sandbox"
    
    def test_client_requires_token(self):
        """Test that client requires access token."""
        with pytest.raises(ValueError, match="access token is required"):
            SquareClient()


class TestUsageTracker:
    """Tests for UsageTracker."""
    
    @pytest.fixture
    def mock_redis(self):
        """Mock Redis client."""
        return Mock()
    
    def test_track_api_call(self, mock_redis):
        """Test tracking API calls."""
        tracker = UsageTracker(redis_client=mock_redis)
        tracker.track_api_call("tenant-1", "/api/devices")
        
        # Verify Redis calls
        assert mock_redis.incr.called
        assert mock_redis.expire.called
    
    def test_get_device_count(self, mock_redis):
        """Test getting device count."""
        mock_redis.get.return_value = "5"
        
        tracker = UsageTracker(redis_client=mock_redis)
        count = tracker.get_device_count("tenant-1")
        
        assert count == 5
    
    def test_calculate_overage(self, mock_redis):
        """Test overage calculation."""
        # Mock usage data
        mock_redis.get.side_effect = lambda key: {
            "usage:devices:tenant-1": "15",  # 5 over limit
            "usage:api_calls:tenant-1:2025-12-07": "1500",  # 500 over limit
            "usage:storage:tenant-1": "7.0"  # 2 GB over limit
        }.get(key, "0")
        
        tracker = UsageTracker(redis_client=mock_redis)
        
        # Create mock Square client
        mock_square = Mock()
        
        overage = tracker.calculate_overage("tenant-1", "starter", mock_square)
        
        assert overage["tenant_id"] == "tenant-1"
        assert overage["plan_id"] == "starter"
        assert overage["usage"]["devices"] == 15
        assert overage["overages"]["devices"] == 5
        assert overage["charges"]["devices"] == 2500  # 5 * $5.00


class TestWebhookHandler:
    """Tests for WebhookHandler."""
    
    def test_initialization(self):
        """Test webhook handler initialization."""
        handler = WebhookHandler(signature_key="test_key")
        
        assert handler.signature_key == "test_key"
    
    def test_handle_subscription_created(self):
        """Test subscription.created event."""
        handler = WebhookHandler()
        
        event_data = {
            "type": "subscription.created",
            "object": {
                "subscription": {
                    "id": "sub_123",
                    "customer_id": "cust_456",
                    "plan_id": "starter",
                    "status": "active"
                }
            }
        }
        
        result = handler.handle_webhook("subscription.created", event_data)
        
        assert result["status"] == "processed"
        assert result["subscription_id"] == "sub_123"
        assert result["action"] == "subscription_activated"
    
    def test_handle_payment_updated_success(self):
        """Test payment.updated event with success status."""
        handler = WebhookHandler()
        
        event_data = {
            "type": "payment.updated",
            "object": {
                "payment": {
                    "id": "pay_123",
                    "status": "COMPLETED",
                    "amount_money": {
                        "amount": 4900,
                        "currency": "USD"
                    }
                }
            }
        }
        
        result = handler.handle_webhook("payment.updated", event_data)
        
        assert result["status"] == "processed"
        assert result["payment_id"] == "pay_123"
        assert result["payment_status"] == "COMPLETED"
        assert result["action"] == "payment_succeeded"
    
    def test_handle_unknown_event(self):
        """Test handling unknown event type."""
        handler = WebhookHandler()
        
        result = handler.handle_webhook("unknown.event", {})
        
        assert result["status"] == "ignored"
        assert result["event_type"] == "unknown.event"
