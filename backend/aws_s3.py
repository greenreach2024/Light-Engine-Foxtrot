"""
AWS S3 Storage Integration for Light Engine
Handles file uploads, downloads, and management in S3
"""

import os
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime
import json

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    logging.warning("boto3 not installed. AWS S3 features will be disabled.")

logger = logging.getLogger(__name__)


class S3Manager:
    """Manages file operations with AWS S3"""
    
    def __init__(
        self,
        bucket_name: Optional[str] = None,
        region: Optional[str] = None,
        aws_access_key_id: Optional[str] = None,
        aws_secret_access_key: Optional[str] = None
    ):
        """
        Initialize S3 Manager
        
        Args:
            bucket_name: S3 bucket name (or use AWS_S3_BUCKET env var)
            region: AWS region (or use AWS_REGION env var)
            aws_access_key_id: AWS access key (or use AWS_ACCESS_KEY_ID env var)
            aws_secret_access_key: AWS secret key (or use AWS_SECRET_ACCESS_KEY env var)
        """
        if not BOTO3_AVAILABLE:
            raise ImportError("boto3 is required for S3 features. Install with: pip install boto3")
        
        self.bucket_name = bucket_name or os.getenv('AWS_S3_BUCKET')
        self.region = region or os.getenv('AWS_REGION', 'us-east-1')
        
        if not self.bucket_name:
            raise ValueError("S3 bucket name must be provided or set in AWS_S3_BUCKET")
        
        # Initialize S3 client
        session_kwargs = {
            'region_name': self.region
        }
        
        if aws_access_key_id and aws_secret_access_key:
            session_kwargs['aws_access_key_id'] = aws_access_key_id
            session_kwargs['aws_secret_access_key'] = aws_secret_access_key
        elif os.getenv('AWS_ACCESS_KEY_ID') and os.getenv('AWS_SECRET_ACCESS_KEY'):
            session_kwargs['aws_access_key_id'] = os.getenv('AWS_ACCESS_KEY_ID')
            session_kwargs['aws_secret_access_key'] = os.getenv('AWS_SECRET_ACCESS_KEY')
        
        try:
            self.s3_client = boto3.client('s3', **session_kwargs)
            self.s3_resource = boto3.resource('s3', **session_kwargs)
            logger.info(f" S3 client initialized for bucket: {self.bucket_name}")
        except NoCredentialsError:
            logger.error(" AWS credentials not found. Configure ~/.aws/credentials or set environment variables.")
            raise
    
    def upload_file(
        self,
        file_path: str,
        s3_key: str,
        metadata: Optional[Dict[str, str]] = None,
        content_type: Optional[str] = None
    ) -> bool:
        """
        Upload a file to S3
        
        Args:
            file_path: Local file path to upload
            s3_key: S3 object key (path in bucket)
            metadata: Optional metadata dict
            content_type: Optional content type (auto-detected if not provided)
        
        Returns:
            True if successful, False otherwise
        """
        try:
            extra_args = {}
            
            if metadata:
                extra_args['Metadata'] = metadata
            
            if content_type:
                extra_args['ContentType'] = content_type
            else:
                # Auto-detect content type
                if s3_key.endswith('.json'):
                    extra_args['ContentType'] = 'application/json'
                elif s3_key.endswith('.html'):
                    extra_args['ContentType'] = 'text/html'
                elif s3_key.endswith('.csv'):
                    extra_args['ContentType'] = 'text/csv'
            
            self.s3_client.upload_file(file_path, self.bucket_name, s3_key, ExtraArgs=extra_args)
            logger.info(f" Uploaded: {file_path} → s3://{self.bucket_name}/{s3_key}")
            return True
            
        except FileNotFoundError:
            logger.error(f" File not found: {file_path}")
            return False
        except ClientError as e:
            logger.error(f" Failed to upload {file_path}: {e}")
            return False
    
    def upload_json(
        self,
        data: Dict[str, Any],
        s3_key: str,
        metadata: Optional[Dict[str, str]] = None
    ) -> bool:
        """
        Upload JSON data directly to S3
        
        Args:
            data: Dictionary to upload as JSON
            s3_key: S3 object key
            metadata: Optional metadata
        
        Returns:
            True if successful
        """
        try:
            json_str = json.dumps(data, indent=2)
            
            extra_args = {
                'ContentType': 'application/json'
            }
            
            if metadata:
                extra_args['Metadata'] = metadata
            
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=json_str.encode('utf-8'),
                **extra_args
            )
            
            logger.info(f" Uploaded JSON → s3://{self.bucket_name}/{s3_key}")
            return True
            
        except ClientError as e:
            logger.error(f" Failed to upload JSON: {e}")
            return False
    
    def download_file(
        self,
        s3_key: str,
        local_path: str
    ) -> bool:
        """
        Download a file from S3
        
        Args:
            s3_key: S3 object key
            local_path: Local path to save file
        
        Returns:
            True if successful
        """
        try:
            # Create directory if needed
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            
            self.s3_client.download_file(self.bucket_name, s3_key, local_path)
            logger.info(f" Downloaded: s3://{self.bucket_name}/{s3_key} → {local_path}")
            return True
            
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                logger.error(f" File not found: s3://{self.bucket_name}/{s3_key}")
            else:
                logger.error(f" Failed to download: {e}")
            return False
    
    def download_json(self, s3_key: str) -> Optional[Dict[str, Any]]:
        """
        Download and parse JSON file from S3
        
        Args:
            s3_key: S3 object key
        
        Returns:
            Parsed JSON dict or None if failed
        """
        try:
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            content = response['Body'].read().decode('utf-8')
            data = json.loads(content)
            logger.info(f" Downloaded JSON: s3://{self.bucket_name}/{s3_key}")
            return data
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                logger.error(f" JSON file not found: {s3_key}")
            else:
                logger.error(f" Failed to download JSON: {e}")
            return None
    
    def list_objects(
        self,
        prefix: str = '',
        max_keys: int = 1000
    ) -> List[Dict[str, Any]]:
        """
        List objects in S3 bucket
        
        Args:
            prefix: Filter by prefix (folder path)
            max_keys: Maximum number of objects to return
        
        Returns:
            List of object metadata dicts
        """
        try:
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix,
                MaxKeys=max_keys
            )
            
            if 'Contents' not in response:
                return []
            
            objects = []
            for obj in response['Contents']:
                objects.append({
                    'key': obj['Key'],
                    'size': obj['Size'],
                    'last_modified': obj['LastModified'].isoformat(),
                    'etag': obj['ETag'].strip('"')
                })
            
            logger.info(f" Listed {len(objects)} objects with prefix: {prefix}")
            return objects
            
        except ClientError as e:
            logger.error(f" Failed to list objects: {e}")
            return []
    
    def delete_object(self, s3_key: str) -> bool:
        """
        Delete an object from S3
        
        Args:
            s3_key: S3 object key
        
        Returns:
            True if successful
        """
        try:
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=s3_key)
            logger.info(f" Deleted: s3://{self.bucket_name}/{s3_key}")
            return True
            
        except ClientError as e:
            logger.error(f" Failed to delete {s3_key}: {e}")
            return False
    
    def object_exists(self, s3_key: str) -> bool:
        """
        Check if an object exists in S3
        
        Args:
            s3_key: S3 object key
        
        Returns:
            True if exists
        """
        try:
            self.s3_client.head_object(Bucket=self.bucket_name, Key=s3_key)
            return True
        except ClientError:
            return False
    
    def get_presigned_url(
        self,
        s3_key: str,
        expiration: int = 3600,
        http_method: str = 'get_object'
    ) -> Optional[str]:
        """
        Generate a presigned URL for temporary access
        
        Args:
            s3_key: S3 object key
            expiration: URL expiration time in seconds (default: 1 hour)
            http_method: 'get_object' or 'put_object'
        
        Returns:
            Presigned URL or None if failed
        """
        try:
            url = self.s3_client.generate_presigned_url(
                http_method,
                Params={'Bucket': self.bucket_name, 'Key': s3_key},
                ExpiresIn=expiration
            )
            logger.info(f" Generated presigned URL for: {s3_key}")
            return url
            
        except ClientError as e:
            logger.error(f" Failed to generate presigned URL: {e}")
            return None
    
    def backup_tenant_data(self, tenant_id: str, data: Dict[str, Any]) -> bool:
        """
        Backup tenant data to S3
        
        Args:
            tenant_id: Tenant identifier
            data: Data to backup
        
        Returns:
            True if successful
        """
        timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
        s3_key = f"tenants/{tenant_id}/backups/backup-{timestamp}.json"
        
        metadata = {
            'tenant_id': tenant_id,
            'backup_timestamp': timestamp,
            'backup_type': 'automated'
        }
        
        return self.upload_json(data, s3_key, metadata)
    
    def save_telemetry(
        self,
        tenant_id: str,
        scope: str,
        telemetry_data: Dict[str, Any]
    ) -> bool:
        """
        Save telemetry data to S3
        
        Args:
            tenant_id: Tenant identifier
            scope: Telemetry scope (e.g., zone ID)
            telemetry_data: Telemetry data dict
        
        Returns:
            True if successful
        """
        date = datetime.utcnow().strftime('%Y-%m-%d')
        timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
        s3_key = f"telemetry/{tenant_id}/{date}/{scope}-{timestamp}.json"
        
        return self.upload_json(telemetry_data, s3_key)
    
    def save_invoice(
        self,
        tenant_id: str,
        invoice_id: str,
        invoice_data: Dict[str, Any]
    ) -> bool:
        """
        Save invoice to S3
        
        Args:
            tenant_id: Tenant identifier
            invoice_id: Invoice ID
            invoice_data: Invoice data
        
        Returns:
            True if successful
        """
        s3_key = f"invoices/{tenant_id}/{invoice_id}.json"
        
        metadata = {
            'tenant_id': tenant_id,
            'invoice_id': invoice_id,
            'created_at': datetime.utcnow().isoformat()
        }
        
        return self.upload_json(invoice_data, s3_key, metadata)


# Example usage
if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(level=logging.INFO)
    
    # Initialize S3 manager
    s3 = S3Manager(
        bucket_name='light-engine-data-production',
        region='us-east-1'
    )
    
    # Upload JSON data
    test_data = {
        'tenant_id': 'test-tenant',
        'timestamp': datetime.utcnow().isoformat(),
        'metrics': {
            'devices': 10,
            'api_calls': 1234,
            'storage_gb': 5.2
        }
    }
    
    s3.upload_json(test_data, 'test/usage-metrics.json')
    
    # Download JSON data
    downloaded = s3.download_json('test/usage-metrics.json')
    print("Downloaded:", downloaded)
    
    # List objects
    objects = s3.list_objects(prefix='test/')
    print(f"Found {len(objects)} objects")
    
    # Backup tenant data
    s3.backup_tenant_data('test-tenant', test_data)
