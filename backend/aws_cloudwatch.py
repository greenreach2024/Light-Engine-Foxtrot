"""
AWS CloudWatch Logging and Metrics Integration
Handles structured logging and custom metrics for Light Engine
"""

import os
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
import json

try:
    import boto3
    from botocore.exceptions import ClientError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    logging.warning("boto3 not installed. CloudWatch features will be disabled.")

logger = logging.getLogger(__name__)


class CloudWatchLogger:
    """Manages CloudWatch log streams and custom metrics"""
    
    def __init__(
        self,
        log_group_name: Optional[str] = None,
        region: Optional[str] = None
    ):
        """
        Initialize CloudWatch Logger
        
        Args:
            log_group_name: CloudWatch log group name (or use AWS_CLOUDWATCH_LOG_GROUP)
            region: AWS region (or use AWS_REGION)
        """
        if not BOTO3_AVAILABLE:
            logger.warning("  boto3 not installed. CloudWatch logging disabled.")
            self.enabled = False
            return
        
        self.log_group_name = log_group_name or os.getenv('AWS_CLOUDWATCH_LOG_GROUP', '/light-engine/production')
        self.region = region or os.getenv('AWS_REGION', 'us-east-1')
        self.enabled = True
        
        try:
            self.logs_client = boto3.client('logs', region_name=self.region)
            self.cloudwatch_client = boto3.client('cloudwatch', region_name=self.region)
            
            # Create log group if it doesn't exist
            self._ensure_log_group_exists()
            
            logger.info(f" CloudWatch logger initialized: {self.log_group_name}")
            
        except Exception as e:
            logger.warning(f"  CloudWatch initialization failed: {e}. Logging disabled.")
            self.enabled = False
    
    def _ensure_log_group_exists(self):
        """Create log group if it doesn't exist"""
        try:
            self.logs_client.create_log_group(logGroupName=self.log_group_name)
            logger.info(f" Created log group: {self.log_group_name}")
        except self.logs_client.exceptions.ResourceAlreadyExistsException:
            pass  # Log group already exists
        except ClientError as e:
            logger.error(f" Failed to create log group: {e}")
    
    def _get_stream_name(self, stream_suffix: str) -> str:
        """Generate log stream name with date prefix"""
        date = datetime.utcnow().strftime('%Y-%m-%d')
        return f"{date}/{stream_suffix}"
    
    def _ensure_log_stream_exists(self, stream_name: str):
        """Create log stream if it doesn't exist"""
        try:
            self.logs_client.create_log_stream(
                logGroupName=self.log_group_name,
                logStreamName=stream_name
            )
        except self.logs_client.exceptions.ResourceAlreadyExistsException:
            pass  # Stream already exists
        except ClientError as e:
            logger.error(f" Failed to create log stream {stream_name}: {e}")
    
    def log_event(
        self,
        stream_name: str,
        message: str,
        level: str = 'INFO',
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Log a structured event to CloudWatch
        
        Args:
            stream_name: Log stream name (will be prefixed with date)
            message: Log message
            level: Log level (INFO, WARNING, ERROR, DEBUG)
            metadata: Additional structured data
        
        Returns:
            True if successful
        """
        if not self.enabled:
            return False
        
        try:
            full_stream_name = self._get_stream_name(stream_name)
            self._ensure_log_stream_exists(full_stream_name)
            
            # Build structured log entry
            log_entry = {
                'timestamp': datetime.utcnow().isoformat(),
                'level': level,
                'message': message
            }
            
            if metadata:
                log_entry['metadata'] = metadata
            
            # Send log event
            self.logs_client.put_log_events(
                logGroupName=self.log_group_name,
                logStreamName=full_stream_name,
                logEvents=[{
                    'timestamp': int(datetime.utcnow().timestamp() * 1000),
                    'message': json.dumps(log_entry)
                }]
            )
            
            return True
            
        except ClientError as e:
            logger.error(f" Failed to log event: {e}")
            return False
    
    def log_api_request(
        self,
        tenant_id: str,
        endpoint: str,
        method: str,
        status_code: int,
        response_time_ms: float,
        error: Optional[str] = None
    ) -> bool:
        """
        Log API request to CloudWatch
        
        Args:
            tenant_id: Tenant identifier
            endpoint: API endpoint path
            method: HTTP method
            status_code: Response status code
            response_time_ms: Response time in milliseconds
            error: Error message if request failed
        
        Returns:
            True if successful
        """
        metadata = {
            'tenant_id': tenant_id,
            'endpoint': endpoint,
            'method': method,
            'status_code': status_code,
            'response_time_ms': response_time_ms
        }
        
        if error:
            metadata['error'] = error
        
        level = 'ERROR' if status_code >= 500 else 'WARNING' if status_code >= 400 else 'INFO'
        message = f"{method} {endpoint} → {status_code} ({response_time_ms:.2f}ms)"
        
        return self.log_event('api-requests', message, level, metadata)
    
    def log_device_event(
        self,
        tenant_id: str,
        device_id: str,
        event_type: str,
        details: Dict[str, Any]
    ) -> bool:
        """
        Log device event to CloudWatch
        
        Args:
            tenant_id: Tenant identifier
            device_id: Device identifier
            event_type: Event type (connected, disconnected, error, etc.)
            details: Event details
        
        Returns:
            True if successful
        """
        metadata = {
            'tenant_id': tenant_id,
            'device_id': device_id,
            'event_type': event_type,
            'details': details
        }
        
        message = f"Device {device_id}: {event_type}"
        level = 'ERROR' if event_type == 'error' else 'WARNING' if event_type == 'disconnected' else 'INFO'
        
        return self.log_event('device-events', message, level, metadata)
    
    def log_automation_execution(
        self,
        tenant_id: str,
        rule_id: str,
        action: str,
        success: bool,
        details: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Log automation rule execution
        
        Args:
            tenant_id: Tenant identifier
            rule_id: Rule identifier
            action: Action taken
            success: Whether execution succeeded
            details: Execution details
        
        Returns:
            True if successful
        """
        metadata = {
            'tenant_id': tenant_id,
            'rule_id': rule_id,
            'action': action,
            'success': success
        }
        
        if details:
            metadata['details'] = details
        
        level = 'ERROR' if not success else 'INFO'
        message = f"Rule {rule_id}: {action} ({'' if success else ''})"
        
        return self.log_event('automation', message, level, metadata)
    
    def put_metric(
        self,
        metric_name: str,
        value: float,
        unit: str = 'Count',
        dimensions: Optional[List[Dict[str, str]]] = None
    ) -> bool:
        """
        Put custom metric to CloudWatch
        
        Args:
            metric_name: Metric name
            value: Metric value
            unit: Metric unit (Count, Seconds, Bytes, etc.)
            dimensions: Metric dimensions (e.g., [{'Name': 'TenantId', 'Value': 'tenant-123'}])
        
        Returns:
            True if successful
        """
        if not self.enabled:
            return False
        
        try:
            metric_data = {
                'MetricName': metric_name,
                'Value': value,
                'Unit': unit,
                'Timestamp': datetime.utcnow()
            }
            
            if dimensions:
                metric_data['Dimensions'] = dimensions
            
            self.cloudwatch_client.put_metric_data(
                Namespace='LightEngine',
                MetricData=[metric_data]
            )
            
            return True
            
        except ClientError as e:
            logger.error(f" Failed to put metric {metric_name}: {e}")
            return False
    
    def put_api_metrics(
        self,
        tenant_id: str,
        endpoint: str,
        response_time_ms: float,
        status_code: int
    ) -> bool:
        """
        Put API metrics to CloudWatch
        
        Args:
            tenant_id: Tenant identifier
            endpoint: API endpoint
            response_time_ms: Response time in milliseconds
            status_code: HTTP status code
        
        Returns:
            True if successful
        """
        dimensions = [
            {'Name': 'TenantId', 'Value': tenant_id},
            {'Name': 'Endpoint', 'Value': endpoint}
        ]
        
        # Response time metric
        self.put_metric('APIResponseTime', response_time_ms, 'Milliseconds', dimensions)
        
        # Request count metric
        self.put_metric('APIRequests', 1, 'Count', dimensions)
        
        # Error count metric (if error)
        if status_code >= 400:
            self.put_metric('APIErrors', 1, 'Count', dimensions)
        
        return True
    
    def put_device_metrics(
        self,
        tenant_id: str,
        device_count: int,
        online_count: int
    ) -> bool:
        """
        Put device metrics to CloudWatch
        
        Args:
            tenant_id: Tenant identifier
            device_count: Total device count
            online_count: Online device count
        
        Returns:
            True if successful
        """
        dimensions = [{'Name': 'TenantId', 'Value': tenant_id}]
        
        self.put_metric('TotalDevices', device_count, 'Count', dimensions)
        self.put_metric('OnlineDevices', online_count, 'Count', dimensions)
        
        # Calculate and send availability percentage
        availability = (online_count / device_count * 100) if device_count > 0 else 0
        self.put_metric('DeviceAvailability', availability, 'Percent', dimensions)
        
        return True
    
    def put_usage_metrics(
        self,
        tenant_id: str,
        api_calls: int,
        storage_bytes: int,
        device_count: int
    ) -> bool:
        """
        Put usage metrics to CloudWatch
        
        Args:
            tenant_id: Tenant identifier
            api_calls: API call count
            storage_bytes: Storage usage in bytes
            device_count: Device count
        
        Returns:
            True if successful
        """
        dimensions = [{'Name': 'TenantId', 'Value': tenant_id}]
        
        self.put_metric('APICalls', api_calls, 'Count', dimensions)
        self.put_metric('StorageUsage', storage_bytes, 'Bytes', dimensions)
        self.put_metric('DeviceCount', device_count, 'Count', dimensions)
        
        return True
    
    def query_logs(
        self,
        stream_name: str,
        start_time: datetime,
        end_time: datetime,
        filter_pattern: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Query CloudWatch logs
        
        Args:
            stream_name: Log stream name (without date prefix)
            start_time: Start time for query
            end_time: End time for query
            filter_pattern: Optional CloudWatch Logs Insights filter
            limit: Maximum number of events to return
        
        Returns:
            List of log events
        """
        if not self.enabled:
            return []
        
        try:
            # Get all stream names for the date range
            stream_prefix = start_time.strftime('%Y-%m-%d')
            full_stream_name = f"{stream_prefix}/{stream_name}"
            
            kwargs = {
                'logGroupName': self.log_group_name,
                'logStreamName': full_stream_name,
                'startTime': int(start_time.timestamp() * 1000),
                'endTime': int(end_time.timestamp() * 1000),
                'limit': limit
            }
            
            if filter_pattern:
                kwargs['filterPattern'] = filter_pattern
            
            response = self.logs_client.filter_log_events(**kwargs)
            
            events = []
            for event in response.get('events', []):
                try:
                    message = json.loads(event['message'])
                    events.append(message)
                except json.JSONDecodeError:
                    events.append({'message': event['message']})
            
            return events
            
        except ClientError as e:
            logger.error(f" Failed to query logs: {e}")
            return []


# Example usage
if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(level=logging.INFO)
    
    # Initialize CloudWatch logger
    cw = CloudWatchLogger(
        log_group_name='/light-engine/production',
        region='us-east-1'
    )
    
    # Log API request
    cw.log_api_request(
        tenant_id='test-tenant',
        endpoint='/api/lights',
        method='GET',
        status_code=200,
        response_time_ms=45.2
    )
    
    # Log device event
    cw.log_device_event(
        tenant_id='test-tenant',
        device_id='grow3-001',
        event_type='connected',
        details={'ip': '192.168.2.100', 'firmware': '2.1.0'}
    )
    
    # Put usage metrics
    cw.put_usage_metrics(
        tenant_id='test-tenant',
        api_calls=1234,
        storage_bytes=5_500_000_000,  # 5.5 GB
        device_count=10
    )
    
    print(" CloudWatch logging examples complete")
