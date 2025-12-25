# Multi-Tenant Cloud Deployment Guide

Complete guide for deploying Light Engine as a multi-tenant SaaS platform on AWS.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [AWS Infrastructure Setup](#aws-infrastructure-setup)
5. [Database Configuration](#database-configuration)
6. [Multi-Tenancy](#multi-tenancy)
7. [Domain and SSL](#domain-and-ssl)
8. [Deployment](#deployment)
9. [Monitoring](#monitoring)
10. [Scaling](#scaling)
11. [Backup and Recovery](#backup-and-recovery)
12. [Troubleshooting](#troubleshooting)

## Overview

Cloud deployment runs Light Engine as a multi-tenant SaaS platform, allowing multiple farms to use the system via their own subdomains.

**Benefits:**
- **Zero Hardware**: No on-site installation required
- **Automatic Updates**: Always latest version
- **Scalability**: Auto-scales with demand
- **High Availability**: 99.9% uptime with Multi-AZ
- **Centralized Management**: Monitor all farms from one dashboard

**Architecture:**
- AWS ECS Fargate (serverless containers)
- RDS PostgreSQL (Multi-AZ)
- Application Load Balancer (SSL/TLS)
- S3 (data storage and backups)
- CloudWatch (monitoring and logging)
- Route 53 (DNS management)

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Internet                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Route 53 (DNS)                             │
│  *.greenreach.io → ALB                                       │
│  central.greenreach.io → Central Dashboard                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│            Application Load Balancer (ALB)                   │
│  - SSL/TLS Termination                                       │
│  - Host-based routing                                        │
│  - Health checks                                             │
└──────────┬──────────────────────────────┬───────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────────┐    ┌─────────────────────────┐
│   ECS Fargate Cluster   │    │  GreenReach Central     │
│   - Main App (2-10)     │    │  - Monitoring (1-2)     │
│   - Auto-scaling        │    │  - Provisioning         │
│   - Health checks       │    │  - Analytics            │
└─────────┬───────────────┘    └─────────┬───────────────┘
          │                              │
          └──────────────┬───────────────┘
                         │
                         ▼
          ┌──────────────────────────────┐
          │    RDS PostgreSQL (Multi-AZ) │
          │    - Encrypted at rest       │
          │    - Automated backups       │
          │    - Point-in-time recovery  │
          └──────────────────────────────┘
                         │
                         ▼
          ┌──────────────────────────────┐
          │    S3 Buckets                │
          │    - Data storage            │
          │    - Backups (Glacier)       │
          │    - Static assets           │
          └──────────────────────────────┘
```

### Network Architecture

```
VPC (10.0.0.0/16)
│
├── Public Subnets (AZ1: 10.0.1.0/24, AZ2: 10.0.2.0/24)
│   ├── Application Load Balancer
│   └── NAT Gateway
│
├── Private Subnets (AZ1: 10.0.10.0/24, AZ2: 10.0.11.0/24)
│   ├── ECS Tasks (Main App)
│   └── ECS Tasks (Central Dashboard)
│
└── Database Subnets (AZ1: 10.0.20.0/24, AZ2: 10.0.21.0/24)
    └── RDS PostgreSQL (Primary + Standby)
```

## Prerequisites

### Required Tools

- AWS CLI v2
- Docker
- Node.js 18+
- PostgreSQL client
- Git

**Install AWS CLI:**
```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verify
aws --version
```

**Configure AWS CLI:**
```bash
aws configure
# AWS Access Key ID: YOUR_KEY
# AWS Secret Access Key: YOUR_SECRET
# Default region: us-east-1
# Default output format: json
```

### AWS Account Setup

1. **Create AWS Account** (if not exists)
2. **IAM User** with permissions:
   - ECS Full Access
   - EC2 Full Access
   - RDS Full Access
   - S3 Full Access
   - CloudWatch Full Access
   - VPC Full Access
   - ALB Full Access
   - Route 53 Full Access
   - Secrets Manager Full Access

3. **Service Quotas** (request increases if needed):
   - ECS tasks: 100+
   - RDS instances: 10+
   - Elastic IPs: 5+

### Domain Setup

1. **Purchase domain** (e.g., greenreach.io) via Route 53 or external registrar
2. **Create hosted zone** in Route 53
3. **Update nameservers** if using external registrar
4. **Verify domain ownership**

## AWS Infrastructure Setup

### Option 1: Automated Deployment (Recommended)

```bash
# Clone repository
git clone https://github.com/greenreach/light-engine-foxtrot.git
cd light-engine-foxtrot/aws-infrastructure

# Set environment variables
export AWS_REGION=us-east-1
export DOMAIN_NAME=greenreach.io
export ADMIN_TOKEN=$(openssl rand -base64 32)

# Run deployment script
./deploy.sh production

# Wait 15-20 minutes for stack creation
# Outputs will include:
# - ALB DNS name
# - RDS endpoint
# - S3 bucket names
# - CloudFormation stack name
```

### Option 2: Manual Deployment

**1. Create CloudFormation Stack:**

```bash
aws cloudformation create-stack \
  --stack-name light-engine-production \
  --template-body file://cloudformation-stack.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=production \
    ParameterKey=DomainName,ParameterValue=greenreach.io \
    ParameterKey=DBPassword,ParameterValue=YOUR_SECURE_PASSWORD \
  --capabilities CAPABILITY_IAM

# Monitor stack creation
aws cloudformation describe-stacks \
  --stack-name light-engine-production \
  --query 'Stacks[0].StackStatus'
```

**2. Build and Push Docker Images:**

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build main app
docker build -t light-engine:latest .

# Tag and push
docker tag light-engine:latest \
  ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/light-engine:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/light-engine:latest

# Build central dashboard
cd greenreach-central-app
docker build -t greenreach-central:latest .
docker tag greenreach-central:latest \
  ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/greenreach-central:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/greenreach-central:latest
```

**3. Update ECS Services:**

```bash
# Update main service
aws ecs update-service \
  --cluster light-engine-production \
  --service main-service \
  --force-new-deployment

# Update central service
aws ecs update-service \
  --cluster light-engine-production \
  --service central-service \
  --force-new-deployment
```

## Database Configuration

### Initial Setup

```bash
# Get RDS endpoint
DB_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name light-engine-production \
  --query 'Stacks[0].Outputs[?OutputKey==`DBEndpoint`].OutputValue' \
  --output text)

# Get DB password from Secrets Manager
DB_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id light-engine-production-db-password \
  --query 'SecretString' \
  --output text)

# Connect to database
psql -h $DB_ENDPOINT -U postgres -d lightengine
```

### Create Schema

```sql
-- Create database
CREATE DATABASE lightengine;

-- Connect to database
\c lightengine;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create schema from migrations
\i /path/to/schema.sql
```

### Configure Connection Pool

Update ECS task definition environment:

```json
{
  "DATABASE_URL": "postgresql://postgres:PASSWORD@ENDPOINT:5432/lightengine?sslmode=require",
  "DB_POOL_MIN": "2",
  "DB_POOL_MAX": "10",
  "DB_IDLE_TIMEOUT": "30000",
  "DB_CONNECTION_TIMEOUT": "2000"
}
```

## Multi-Tenancy

### Tenant Isolation

Each farm operates as an isolated tenant with:
- Subdomain routing (farm1.greenreach.io)
- Database row-level partitioning (tenant_id)
- Separate data storage paths in S3

### Provisioning New Farm

**Via GreenReach Central UI:**

1. Navigate to https://central.greenreach.io/register.html
2. Fill in farm details:
   - Farm name
   - Contact email
   - License tier (inventory-only/full/enterprise)
   - License duration
3. Click "Register Farm"
4. Copy activation code
5. Send activation code to farm customer

**Via API:**

```bash
curl -X POST https://central.greenreach.io/api/provisioning/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "farmName": "Green Valley Farm",
    "email": "owner@greenvalley.com",
    "tier": "full",
    "deploymentMode": "cloud",
    "licenseDuration": 365
  }'
```

**Response:**
```json
{
  "ok": true,
  "farm": {
    "id": "green-valley-farm",
    "name": "Green Valley Farm",
    "subdomain": "green-valley-farm",
    "url": "https://green-valley-farm.greenreach.io"
  },
  "activationCode": "ABCD-1234-WXYZ-5678",
  "license": {
    "tier": "full",
    "expires": "2026-12-24T00:00:00.000Z"
  }
}
```

### Subdomain Configuration

**Update Route 53:**

```bash
# Get ALB DNS name
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name light-engine-production \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

# Create wildcard record
aws route53 change-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "*.greenreach.io",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "'$ALB_DNS'"}]
      }
    }]
  }'
```

### Tenant Database Access

Application uses middleware to scope all queries by tenant:

```javascript
// server/middleware/multi-tenant.js
class TenantDb {
  constructor(tenantId) {
    this.tenantId = tenantId;
  }
  
  async query(sql, params) {
    // Automatically adds WHERE tenant_id = $tenantId
    return db.query(
      `${sql} AND tenant_id = $1`,
      [...params, this.tenantId]
    );
  }
}
```

All routes automatically get tenant context from subdomain:

```javascript
// Extract tenant from subdomain
const tenantId = req.hostname.split('.')[0];
req.db = new TenantDb(tenantId);
```

## Domain and SSL

### SSL Certificate (ACM)

**Request certificate:**

```bash
# Request wildcard certificate
aws acm request-certificate \
  --domain-name greenreach.io \
  --subject-alternative-names "*.greenreach.io" \
  --validation-method DNS

# Get certificate ARN
CERT_ARN=$(aws acm list-certificates \
  --query 'CertificateSummaryList[?DomainName==`greenreach.io`].CertificateArn' \
  --output text)
```

**Validate certificate:**

```bash
# Get validation records
aws acm describe-certificate \
  --certificate-arn $CERT_ARN \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'

# Add CNAME record to Route 53
aws route53 change-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --change-batch file://validation-record.json
```

**Update ALB listener:**

```bash
# Add HTTPS listener
aws elbv2 create-listener \
  --load-balancer-arn YOUR_ALB_ARN \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=$CERT_ARN \
  --default-actions Type=forward,TargetGroupArn=YOUR_TARGET_GROUP_ARN
```

### Force HTTPS Redirect

```bash
# Add HTTP listener with redirect
aws elbv2 create-listener \
  --load-balancer-arn YOUR_ALB_ARN \
  --protocol HTTP \
  --port 80 \
  --default-actions \
    Type=redirect,RedirectConfig='{Protocol=HTTPS,Port=443,StatusCode=HTTP_301}'
```

## Deployment

### CI/CD Pipeline (CodePipeline)

**Create buildspec.yml:**

```yaml
version: 0.2
phases:
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
      - COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)
      - IMAGE_TAG=${COMMIT_HASH:=latest}
  build:
    commands:
      - echo Building Docker images...
      - docker build -t $ECR_REGISTRY/light-engine:$IMAGE_TAG .
      - docker build -t $ECR_REGISTRY/greenreach-central:$IMAGE_TAG ./greenreach-central-app
  post_build:
    commands:
      - echo Pushing Docker images...
      - docker push $ECR_REGISTRY/light-engine:$IMAGE_TAG
      - docker push $ECR_REGISTRY/greenreach-central:$IMAGE_TAG
      - echo Writing image definitions...
      - printf '[{"name":"app","imageUri":"%s"}]' $ECR_REGISTRY/light-engine:$IMAGE_TAG > imagedefinitions.json
artifacts:
  files:
    - imagedefinitions.json
```

**Create pipeline:**

```bash
aws codepipeline create-pipeline \
  --pipeline file://pipeline-config.json
```

### Manual Deployment

**Zero-downtime deployment:**

```bash
# Build new images
docker build -t light-engine:v2.0.0 .

# Tag and push
docker tag light-engine:v2.0.0 $ECR_REGISTRY/light-engine:v2.0.0
docker push $ECR_REGISTRY/light-engine:v2.0.0

# Update ECS service (rolling update)
aws ecs update-service \
  --cluster light-engine-production \
  --service main-service \
  --task-definition light-engine-task:NEW_REVISION \
  --force-new-deployment

# Monitor deployment
aws ecs describe-services \
  --cluster light-engine-production \
  --services main-service \
  --query 'services[0].deployments'
```

**Rollback:**

```bash
# Revert to previous task definition
aws ecs update-service \
  --cluster light-engine-production \
  --service main-service \
  --task-definition light-engine-task:PREVIOUS_REVISION
```

## Monitoring

### CloudWatch Dashboards

**Create custom dashboard:**

```bash
aws cloudwatch put-dashboard \
  --dashboard-name LightEngineProduction \
  --dashboard-body file://dashboard-config.json
```

**Key metrics to monitor:**

- **ECS Service**:
  - CPUUtilization (target: <70%)
  - MemoryUtilization (target: <80%)
  - DesiredTaskCount vs RunningTaskCount
  - TargetResponseTime (target: <500ms)

- **RDS Database**:
  - DatabaseConnections (monitor for connection pool exhaustion)
  - CPUUtilization (target: <70%)
  - FreeableMemory (alert if <500MB)
  - ReadLatency / WriteLatency (target: <10ms)

- **Application Load Balancer**:
  - TargetResponseTime
  - HTTPCode_Target_5XX_Count (alert on increase)
  - HealthyHostCount (alert if <1)
  - RequestCount (for capacity planning)

### CloudWatch Alarms

**Create critical alarms:**

```bash
# High CPU alert
aws cloudwatch put-metric-alarm \
  --alarm-name ecs-high-cpu \
  --alarm-description "ECS CPU usage above 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ClusterName,Value=light-engine-production

# Database connection pool exhaustion
aws cloudwatch put-metric-alarm \
  --alarm-name rds-high-connections \
  --alarm-description "RDS connections above 90" \
  --metric-name DatabaseConnections \
  --namespace AWS/RDS \
  --statistic Average \
  --period 60 \
  --evaluation-periods 3 \
  --threshold 90 \
  --comparison-operator GreaterThanThreshold
```

### Application Logging

**View logs:**

```bash
# Get log group
aws logs describe-log-groups \
  --log-group-name-prefix /ecs/light-engine

# Tail logs
aws logs tail /ecs/light-engine-production --follow

# Filter errors
aws logs filter-log-events \
  --log-group-name /ecs/light-engine-production \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '1 hour ago' +%s)000
```

**Log insights queries:**

```sql
-- Top 10 errors
fields @timestamp, @message
| filter @message like /ERROR/
| stats count() by @message
| sort count desc
| limit 10

-- Slow queries
fields @timestamp, duration, query
| filter duration > 1000
| sort duration desc
| limit 20

-- Request volume by tenant
fields @timestamp, tenant_id
| stats count() by tenant_id
| sort count desc
```

## Scaling

### Auto-Scaling Configuration

**CPU-based scaling:**

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/light-engine-production/main-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Create scaling policy
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/light-engine-production/main-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name cpu-scaling-policy \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'
```

### Database Scaling

**Vertical scaling (change instance type):**

```bash
# Modify DB instance
aws rds modify-db-instance \
  --db-instance-identifier light-engine-production \
  --db-instance-class db.t3.large \
  --apply-immediately
```

**Read replicas (for read-heavy workloads):**

```bash
# Create read replica
aws rds create-db-instance-read-replica \
  --db-instance-identifier light-engine-production-replica \
  --source-db-instance-identifier light-engine-production \
  --db-instance-class db.t3.medium
```

### Cost Optimization

**Use Fargate Spot:**

```yaml
# Update capacity providers in task definition
capacityProviders:
  - FARGATE
  - FARGATE_SPOT
capacityProviderStrategy:
  - capacityProvider: FARGATE_SPOT
    weight: 4
    base: 0
  - capacityProvider: FARGATE
    weight: 1
    base: 2  # Always keep 2 on regular Fargate
```

**Estimated monthly costs:**

- **Development** (~$100-150):
  - ECS: 2 tasks × t3.small
  - RDS: db.t3.micro Single-AZ
  - ALB: $16 + data transfer

- **Production** (~$250-400):
  - ECS: 2-10 tasks × t3.small with Spot
  - RDS: db.t3.medium Multi-AZ
  - ALB: $16 + data transfer
  - S3: $5-10 for storage
  - CloudWatch: $10-20

- **Enterprise** (~$800-1200):
  - ECS: 4-20 tasks × t3.medium with Spot
  - RDS: db.r5.large Multi-AZ with read replica
  - ALB: $16 + data transfer
  - S3: $20-50 for storage
  - CloudWatch: $50-100

## Backup and Recovery

### RDS Automated Backups

**Configure backup retention:**

```bash
aws rds modify-db-instance \
  --db-instance-identifier light-engine-production \
  --backup-retention-period 30 \
  --preferred-backup-window "03:00-04:00"
```

### Point-in-Time Recovery

**Restore to specific time:**

```bash
# Restore to 2 hours ago
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier light-engine-production \
  --target-db-instance-identifier light-engine-restored \
  --restore-time $(date -u -d '2 hours ago' --iso-8601=seconds)
```

### Application Data Backups

**Daily S3 backups:**

```bash
# Backup script runs at 2 AM daily
aws s3 sync s3://light-engine-production-data s3://light-engine-production-backups/$(date +%Y%m%d)/ \
  --storage-class GLACIER
```

**Restore from backup:**

```bash
# List available backups
aws s3 ls s3://light-engine-production-backups/

# Restore specific backup
aws s3 sync s3://light-engine-production-backups/20251224/ s3://light-engine-production-data/
```

### Disaster Recovery

**Cross-region replication:**

```bash
# Enable S3 replication to backup region
aws s3api put-bucket-replication \
  --bucket light-engine-production-data \
  --replication-configuration file://replication-config.json

# Create RDS snapshot copy to another region
aws rds copy-db-snapshot \
  --source-db-snapshot-identifier arn:aws:rds:us-east-1:ACCOUNT:snapshot:prod-snapshot \
  --target-db-snapshot-identifier prod-snapshot-dr \
  --source-region us-east-1 \
  --region us-west-2
```

## Troubleshooting

### ECS Tasks Failing

**Check task logs:**

```bash
# Get task ARN
aws ecs list-tasks \
  --cluster light-engine-production \
  --service-name main-service

# Describe task
aws ecs describe-tasks \
  --cluster light-engine-production \
  --tasks TASK_ARN

# View logs
aws logs tail /ecs/light-engine-production --follow
```

**Common issues:**

1. **Image pull errors**: Check ECR permissions
2. **Health check failures**: Verify `/health` endpoint
3. **Resource constraints**: Increase task CPU/memory

### Database Connection Issues

**Check connections:**

```sql
-- View active connections
SELECT * FROM pg_stat_activity;

-- Kill idle connections
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' 
AND state_change < NOW() - INTERVAL '1 hour';
```

**Increase connection limit:**

```bash
aws rds modify-db-instance \
  --db-instance-identifier light-engine-production \
  --db-parameter-group-name custom-postgres-params
```

### High Latency

**Check ALB target health:**

```bash
aws elbv2 describe-target-health \
  --target-group-arn YOUR_TARGET_GROUP_ARN
```

**Enable access logs:**

```bash
aws elbv2 modify-load-balancer-attributes \
  --load-balancer-arn YOUR_ALB_ARN \
  --attributes \
    Key=access_logs.s3.enabled,Value=true \
    Key=access_logs.s3.bucket,Value=YOUR_BUCKET
```

## Support

- **AWS Support**: Console → Support Center
- **Documentation**: https://docs.greenreach.io
- **Status Page**: https://status.greenreach.io
- **Emergency**: support@greenreach.io

## Next Steps

- [Edge Deployment Guide](EDGE_DEPLOYMENT_GUIDE.md)
- [Desktop App Guide](DESKTOP_APP_GUIDE.md)
- [Wholesale Integration](WHOLESALE_INTEGRATION_GUIDE.md)
- [Security Hardening](SECURITY_HARDENING_GUIDE.md)
