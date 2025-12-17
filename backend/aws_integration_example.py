"""
Example FastAPI Integration with AWS S3 and CloudWatch
Shows how to integrate aws_s3.py and aws_cloudwatch.py into backend/server.py
"""

import os
import time
import logging
from typing import Optional, Dict, Any
from datetime import datetime
from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager

# Import AWS modules (will gracefully degrade if boto3 not installed)
try:
    from backend.aws_s3 import S3Manager
    from backend.aws_cloudwatch import CloudWatchLogger
    AWS_ENABLED = True
except ImportError:
    AWS_ENABLED = False
    logging.warning("⚠️  AWS modules not available. S3 and CloudWatch features disabled.")

logger = logging.getLogger(__name__)


# ============================================================================
# AWS Service Initialization
# ============================================================================

def init_aws_services() -> Dict[str, Any]:
    """Initialize AWS services with environment configuration"""
    services = {
        's3': None,
        'cloudwatch': None,
        'enabled': False
    }
    
    if not AWS_ENABLED:
        logger.warning("⚠️  AWS features disabled (boto3 not installed)")
        return services
    
    try:
        # Initialize S3 Manager
        s3_bucket = os.getenv('AWS_S3_BUCKET', 'light-engine-data-production')
        s3_region = os.getenv('AWS_REGION', 'us-east-1')
        
        services['s3'] = S3Manager(
            bucket_name=s3_bucket,
            region=s3_region
        )
        logger.info(f"✅ S3 Manager initialized: {s3_bucket}")
        
        # Initialize CloudWatch Logger
        cw_log_group = os.getenv('AWS_CLOUDWATCH_LOG_GROUP', '/light-engine/production')
        cw_enabled = os.getenv('AWS_CLOUDWATCH_ENABLED', 'true').lower() == 'true'
        
        if cw_enabled:
            services['cloudwatch'] = CloudWatchLogger(
                log_group_name=cw_log_group,
                region=s3_region
            )
            logger.info(f"✅ CloudWatch Logger initialized: {cw_log_group}")
        
        services['enabled'] = True
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize AWS services: {e}")
        logger.warning("⚠️  Continuing without AWS integration")
    
    return services


# Global AWS services (initialized at startup)
aws_services: Dict[str, Any] = {}


# ============================================================================
# FastAPI Lifespan Context (Startup/Shutdown)
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for FastAPI app"""
    global aws_services
    
    # Startup
    logger.info("🚀 Starting Light Engine Backend...")
    aws_services = init_aws_services()
    
    if aws_services['enabled']:
        logger.info("✅ AWS integration active")
    else:
        logger.warning("⚠️  AWS integration disabled")
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down Light Engine Backend...")


# ============================================================================
# FastAPI Application with Middleware
# ============================================================================

app = FastAPI(
    title="Light Engine API",
    version="1.0.0",
    lifespan=lifespan
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    """
    Log all API requests to CloudWatch
    Also tracks response time and sends metrics
    """
    start_time = time.time()
    
    # Extract tenant ID from headers or path
    tenant_id = request.headers.get('X-Tenant-ID', 'unknown')
    if tenant_id == 'unknown' and '/api/' in request.url.path:
        # Try to extract from path like /api/tenants/{tenant_id}/...
        parts = request.url.path.split('/')
        if 'tenants' in parts:
            idx = parts.index('tenants')
            if len(parts) > idx + 1:
                tenant_id = parts[idx + 1]
    
    # Process request
    response = await call_next(request)
    
    # Calculate response time
    response_time_ms = (time.time() - start_time) * 1000
    
    # Log to CloudWatch (if enabled)
    if aws_services.get('enabled') and aws_services.get('cloudwatch'):
        cw: CloudWatchLogger = aws_services['cloudwatch']
        
        # Log API request
        cw.log_api_request(
            tenant_id=tenant_id,
            endpoint=request.url.path,
            method=request.method,
            status_code=response.status_code,
            response_time_ms=response_time_ms,
            error=None if response.status_code < 400 else f"HTTP {response.status_code}"
        )
        
        # Send metrics
        cw.put_api_metrics(
            tenant_id=tenant_id,
            endpoint=request.url.path,
            response_time_ms=response_time_ms,
            status_code=response.status_code
        )
    
    # Add response time header
    response.headers['X-Response-Time'] = f"{response_time_ms:.2f}ms"
    
    return response


@app.middleware("http")
async def error_logging_middleware(request: Request, call_next):
    """Log exceptions to CloudWatch"""
    try:
        return await call_next(request)
    except Exception as e:
        logger.error(f"❌ Unhandled exception: {e}", exc_info=True)
        
        # Log to CloudWatch
        if aws_services.get('enabled') and aws_services.get('cloudwatch'):
            cw: CloudWatchLogger = aws_services['cloudwatch']
            cw.log_event(
                stream_name='errors',
                message=f"Unhandled exception: {str(e)}",
                level='ERROR',
                metadata={
                    'endpoint': request.url.path,
                    'method': request.method,
                    'exception_type': type(e).__name__
                }
            )
        
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error", "detail": str(e)}
        )


# ============================================================================
# Example Endpoints with AWS Integration
# ============================================================================

@app.get("/")
async def root():
    """Root endpoint with AWS status"""
    return {
        "status": "ok",
        "service": "Light Engine API",
        "version": "1.0.0",
        "aws_enabled": aws_services.get('enabled', False),
        "features": {
            "s3_storage": aws_services.get('s3') is not None,
            "cloudwatch_logging": aws_services.get('cloudwatch') is not None
        }
    }


@app.get("/api/health")
async def health_check():
    """Health check with AWS connectivity status"""
    health = {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "aws": {
            "enabled": aws_services.get('enabled', False),
            "s3": "unknown",
            "cloudwatch": "unknown"
        }
    }
    
    # Check S3 connectivity
    if aws_services.get('s3'):
        try:
            s3: S3Manager = aws_services['s3']
            # Simple connectivity test
            health['aws']['s3'] = "healthy"
        except Exception as e:
            health['aws']['s3'] = f"error: {str(e)}"
            health['status'] = "degraded"
    
    # Check CloudWatch connectivity
    if aws_services.get('cloudwatch'):
        try:
            cw: CloudWatchLogger = aws_services['cloudwatch']
            health['aws']['cloudwatch'] = "healthy" if cw.enabled else "disabled"
        except Exception as e:
            health['aws']['cloudwatch'] = f"error: {str(e)}"
            health['status'] = "degraded"
    
    return health


@app.post("/api/tenants/{tenant_id}/backup")
async def backup_tenant_data(tenant_id: str, data: Dict[str, Any]):
    """
    Backup tenant data to S3
    
    Example:
        POST /api/tenants/farm-123/backup
        {
            "devices": [...],
            "groups": [...],
            "automation_rules": [...]
        }
    """
    if not aws_services.get('enabled') or not aws_services.get('s3'):
        raise HTTPException(status_code=503, detail="S3 storage not available")
    
    try:
        s3: S3Manager = aws_services['s3']
        
        # Backup tenant data with timestamp
        success = s3.backup_tenant_data(tenant_id, data)
        
        if not success:
            raise HTTPException(status_code=500, detail="Backup failed")
        
        # Log to CloudWatch
        if aws_services.get('cloudwatch'):
            cw: CloudWatchLogger = aws_services['cloudwatch']
            cw.log_event(
                stream_name='backups',
                message=f"Tenant backup created: {tenant_id}",
                level='INFO',
                metadata={'tenant_id': tenant_id, 'data_size': len(str(data))}
            )
        
        return {
            "status": "success",
            "tenant_id": tenant_id,
            "backup_timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Backup failed for {tenant_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tenants/{tenant_id}/telemetry")
async def save_telemetry(tenant_id: str, scope: str, telemetry: Dict[str, Any]):
    """
    Save telemetry data to S3
    
    Example:
        POST /api/tenants/farm-123/telemetry?scope=zone-alpha
        {
            "timestamp": "2025-12-07T10:00:00Z",
            "metrics": {
                "temperature": 22.5,
                "humidity": 65.0,
                "co2": 1200,
                "ppfd": 850
            }
        }
    """
    if not aws_services.get('enabled') or not aws_services.get('s3'):
        raise HTTPException(status_code=503, detail="S3 storage not available")
    
    try:
        s3: S3Manager = aws_services['s3']
        
        # Save telemetry with tenant/date organization
        success = s3.save_telemetry(tenant_id, scope, telemetry)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save telemetry")
        
        return {
            "status": "success",
            "tenant_id": tenant_id,
            "scope": scope,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Telemetry save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/tenants/{tenant_id}/telemetry")
async def list_telemetry(tenant_id: str, date: Optional[str] = None):
    """
    List telemetry files for a tenant
    
    Example:
        GET /api/tenants/farm-123/telemetry?date=2025-12-07
    """
    if not aws_services.get('enabled') or not aws_services.get('s3'):
        raise HTTPException(status_code=503, detail="S3 storage not available")
    
    try:
        s3: S3Manager = aws_services['s3']
        
        # Build prefix for S3 listing
        if date:
            prefix = f"telemetry/{tenant_id}/{date}/"
        else:
            prefix = f"telemetry/{tenant_id}/"
        
        # List objects
        objects = s3.list_objects(prefix=prefix)
        
        return {
            "status": "success",
            "tenant_id": tenant_id,
            "date": date,
            "count": len(objects),
            "files": objects
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to list telemetry: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/devices/{device_id}/events")
async def log_device_event(
    device_id: str,
    tenant_id: str,
    event_type: str,
    details: Dict[str, Any]
):
    """
    Log device event to CloudWatch
    
    Example:
        POST /api/devices/grow3-001/events
        {
            "tenant_id": "farm-123",
            "event_type": "connected",
            "details": {
                "ip": "192.168.2.100",
                "firmware": "2.1.0"
            }
        }
    """
    if not aws_services.get('enabled') or not aws_services.get('cloudwatch'):
        raise HTTPException(status_code=503, detail="CloudWatch logging not available")
    
    try:
        cw: CloudWatchLogger = aws_services['cloudwatch']
        
        # Log device event
        success = cw.log_device_event(
            tenant_id=tenant_id,
            device_id=device_id,
            event_type=event_type,
            details=details
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to log event")
        
        return {
            "status": "success",
            "device_id": device_id,
            "event_type": event_type,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to log device event: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/automation/{rule_id}/log")
async def log_automation_execution(
    rule_id: str,
    tenant_id: str,
    action: str,
    success: bool,
    details: Optional[Dict[str, Any]] = None
):
    """
    Log automation rule execution to CloudWatch
    
    Example:
        POST /api/automation/rule-001/log
        {
            "tenant_id": "farm-123",
            "action": "Set lights to 80%",
            "success": true,
            "details": {
                "devices_affected": 5,
                "duration_ms": 1200
            }
        }
    """
    if not aws_services.get('enabled') or not aws_services.get('cloudwatch'):
        raise HTTPException(status_code=503, detail="CloudWatch logging not available")
    
    try:
        cw: CloudWatchLogger = aws_services['cloudwatch']
        
        # Log automation execution
        log_success = cw.log_automation_execution(
            tenant_id=tenant_id,
            rule_id=rule_id,
            action=action,
            success=success,
            details=details
        )
        
        if not log_success:
            raise HTTPException(status_code=500, detail="Failed to log execution")
        
        return {
            "status": "logged",
            "rule_id": rule_id,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to log automation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tenants/{tenant_id}/metrics")
async def update_tenant_metrics(
    tenant_id: str,
    api_calls: int,
    storage_bytes: int,
    device_count: int
):
    """
    Update tenant usage metrics in CloudWatch
    
    Example:
        POST /api/tenants/farm-123/metrics
        {
            "api_calls": 1234,
            "storage_bytes": 5500000000,
            "device_count": 10
        }
    """
    if not aws_services.get('enabled') or not aws_services.get('cloudwatch'):
        raise HTTPException(status_code=503, detail="CloudWatch metrics not available")
    
    try:
        cw: CloudWatchLogger = aws_services['cloudwatch']
        
        # Send usage metrics to CloudWatch
        success = cw.put_usage_metrics(
            tenant_id=tenant_id,
            api_calls=api_calls,
            storage_bytes=storage_bytes,
            device_count=device_count
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to send metrics")
        
        return {
            "status": "success",
            "tenant_id": tenant_id,
            "metrics_sent": ["APICalls", "StorageUsage", "DeviceCount"],
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to send metrics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    # Load environment variables
    from dotenv import load_dotenv
    load_dotenv('.env.aws')
    
    # Run server
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
