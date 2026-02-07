# AWS Testing Environment

Cost-optimized AWS deployment for Light Engine Foxtrot testing and validation.

## 💰 Cost Breakdown

| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| **ECS Fargate** | 1 task (0.5 vCPU, 1GB RAM, 24/7) | ~$15 |
| **RDS PostgreSQL** | db.t4g.micro, Single AZ, 20GB | ~$13 |
| **ElastiCache Redis** | cache.t4g.micro | ~$13 |
| **S3** | 10GB storage | ~$0.23 |
| **CloudWatch Logs** | 1GB/month | ~$0.50 |
| **ECR** | 1GB images | ~$0.10 |
| **Secrets Manager** | 2 secrets | ~$0.80 |
| **Data Transfer** | <1GB outbound | ~$0.09 |
| | | |
| **Total** | | **~$43/month** |
| **With Free Tier (Year 1)** | | **~$32/month** |

> **Free Tier Benefits (First 12 months):**
> - RDS: 750 hours/month db.t4g.micro (covers 24/7)
> - ElastiCache: 750 hours/month cache.t4g.micro (covers 24/7)
> - 10GB database storage free

## 🚀 Quick Start

### Prerequisites

```bash
# Install AWS CLI
brew install awscli

# Configure credentials
aws configure
# Enter: Access Key, Secret Key, Region (us-east-1), Output (json)

# Verify
aws sts get-caller-identity
```

### Deployment (3 Steps)

```bash
# Step 1: Create infrastructure (10-15 minutes)
cd /Users/petergilbert/Light-Engine-Foxtrot
chmod +x aws-testing/*.sh
./aws-testing/setup-infrastructure.sh

# Step 2: Migrate database (5-10 minutes)
source aws-testing/config.env
./aws-testing/migrate-database.sh

# Step 3: Deploy application (5 minutes)
./aws-testing/deploy-ecs.sh
```

**Total time**: 20-30 minutes

## 📋 What Gets Created

### Network Infrastructure
- **VPC**: 10.0.0.0/16
- **Public Subnets**: 2 subnets in us-east-1a and us-east-1b
- **Internet Gateway**: For public internet access
- **Security Groups**: 
  - ECS (allows port 8091, 8000)
  - RDS (allows PostgreSQL from ECS)
  - Redis (allows Redis from ECS)

### Compute
- **ECS Cluster**: foxtrot-test
- **ECS Service**: 1 Fargate task running Node.js + Python
- **Docker Image**: Stored in ECR

### Databases
- **RDS PostgreSQL 16**: db.t4g.micro, 20GB storage, Single AZ
- **ElastiCache Redis 7**: cache.t4g.micro

### Secrets
- **foxtrot-test/database**: RDS credentials
- **foxtrot-test/jwt-secret**: JWT signing key

### Monitoring
- **CloudWatch Logs**: /ecs/foxtrot-test

## 🔧 Architecture Decisions

### Cost Optimizations Applied

1. **No NAT Gateway** (-$84/month)
   - Use public subnets with security groups
   - ECS tasks get public IPs directly

2. **Single ECS Task** (-$75/month)
   - No auto-scaling (testing only)
   - Combined Node + Python in one container

3. **Single-AZ RDS** (-$13/month)
   - No Multi-AZ failover (acceptable for testing)

4. **No IoT Core** (-$10/month)
   - Keep local MQTT broker (mqtt://192.168.2.42:1883)
   - Migrate to IoT Core only when 10+ production farms

5. **No CodePipeline** (-$1/month)
   - Manual deployments with `deploy-ecs.sh`

6. **No ALB** (-$16/month)
   - Access ECS task via public IP
   - Add ALB later for production load balancing

7. **Manual Database Migration** (-$50/month)
   - One-time pg_dump/restore (not AWS DMS)

**Total Savings**: $249/month vs production-grade setup

## 🧪 Testing Scenarios

### Functional Testing
```bash
# Get ECS task public IP
source aws-testing/config.env
TASK_ARN=$(aws ecs list-tasks --cluster foxtrot-test --service-name foxtrot --query 'taskArns[0]' --output text)
ENI_ID=$(aws ecs describe-tasks --cluster foxtrot-test --tasks $TASK_ARN --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' --output text)
PUBLIC_IP=$(aws ec2 describe-network-interfaces --network-interface-ids $ENI_ID --query 'NetworkInterfaces[0].Association.PublicIp' --output text)

# Test Node.js server
curl http://$PUBLIC_IP:8091/health
curl http://$PUBLIC_IP:8091/api/wholesale/catalog

# Test Python backend
curl http://$PUBLIC_IP:8000/healthz

# Test dashboard
open http://$PUBLIC_IP:8091/views/nutrient-management.html
```

### Database Validation
```bash
# Connect to RDS
source aws-testing/config.env
DB_SECRET=$(aws secretsmanager get-secret-value --secret-id foxtrot-test/database --query SecretString --output text)
RDS_PASSWORD=$(echo "$DB_SECRET" | jq -r .password)

psql -h $RDS_ENDPOINT -U foxtrot -d lightengine

# Check row counts
SELECT 'farms', COUNT(*) FROM farms
UNION ALL SELECT 'wholesale_buyers', COUNT(*) FROM wholesale_buyers
UNION ALL SELECT 'wholesale_orders', COUNT(*) FROM wholesale_orders;
```

### Performance Testing
```bash
# Install Apache Bench
brew install apache-bench

# Load test (100 concurrent, 1000 requests)
ab -n 1000 -c 100 http://$PUBLIC_IP:8091/api/wholesale/catalog

# Target metrics:
# - Requests per second: >50
# - Mean latency: <500ms
# - Failed requests: 0
```

## 📊 Monitoring

### View Logs
```bash
# Follow logs in real-time
aws logs tail /ecs/foxtrot-test --follow

# Filter errors only
aws logs tail /ecs/foxtrot-test --follow --filter-pattern "ERROR"

# Last 1 hour
aws logs tail /ecs/foxtrot-test --since 1h
```

### Check Service Health
```bash
# ECS service status
aws ecs describe-services --cluster foxtrot-test --services foxtrot

# Task status
aws ecs describe-tasks --cluster foxtrot-test --tasks $TASK_ARN

# RDS status
aws rds describe-db-instances --db-instance-identifier foxtrot-test

# Redis status
aws elasticache describe-cache-clusters --cache-cluster-id foxtrot-test
```

## 🔄 Updates & Redeployment

### Update Application Code
```bash
# 1. Make code changes locally
# 2. Rebuild and deploy
./aws-testing/deploy-ecs.sh

# Force new deployment (without code changes)
aws ecs update-service \
  --cluster foxtrot-test \
  --service foxtrot \
  --force-new-deployment
```

### Update Database Schema
```bash
# 1. Test migration locally first
psql -h localhost -U lightengine -d lightengine -f db/migrations/009_new_feature.sql

# 2. Apply to RDS
source aws-testing/config.env
DB_SECRET=$(aws secretsmanager get-secret-value --secret-id foxtrot-test/database --query SecretString --output text)
RDS_PASSWORD=$(echo "$DB_SECRET" | jq -r .password)

PGPASSWORD="$RDS_PASSWORD" psql -h $RDS_ENDPOINT -U foxtrot -d lightengine -f db/migrations/009_new_feature.sql
```

## 🧹 Cleanup & Cost Management

### Stop Services (Keep Infrastructure)
```bash
# Stop ECS service (saves ~$15/month)
aws ecs update-service --cluster foxtrot-test --service foxtrot --desired-count 0

# Stop RDS (1-7 days max, saves ~$13/month)
aws rds stop-db-instance --db-instance-identifier foxtrot-test
```

### Delete Everything
```bash
# WARNING: This deletes all data!

# Delete ECS service
aws ecs delete-service --cluster foxtrot-test --service foxtrot --force

# Delete ECS cluster
aws ecs delete-cluster --cluster foxtrot-test

# Delete RDS (creates final snapshot)
aws rds delete-db-instance \
  --db-instance-identifier foxtrot-test \
  --final-db-snapshot-identifier foxtrot-test-final-$(date +%Y%m%d)

# Delete Redis
aws elasticache delete-cache-cluster --cache-cluster-id foxtrot-test

# Delete ECR repository
aws ecr delete-repository --repository-name foxtrot-test --force

# Delete secrets
aws secretsmanager delete-secret --secret-id foxtrot-test/database --force-delete-without-recovery
aws secretsmanager delete-secret --secret-id foxtrot-test/jwt-secret --force-delete-without-recovery

# Delete VPC resources (subnets, security groups, etc.)
# Note: Must delete ENIs first, then in order:
# 1. Security groups
# 2. Subnets
# 3. Route tables
# 4. Internet gateway
# 5. VPC
```

## 🚦 Migration to Production

When ready to scale (10+ farms, paying customers):

### Add High Availability (+$84/month)
```bash
# 1. Create NAT Gateways in each AZ
# 2. Move ECS tasks to private subnets
# 3. Enable RDS Multi-AZ
# 4. Add Application Load Balancer
```

### Add Auto-Scaling (+$75/month)
```bash
# 1. Configure ECS auto-scaling (2-10 tasks)
# 2. Add RDS read replicas
# 3. Scale Redis to cluster mode
```

### Add IoT Core (+$10/month)
```bash
# 1. Register nutrient controllers as IoT Things
# 2. Deploy Lambda functions for MQTT ingestion
# 3. Configure IoT Greengrass on edge devices
```

### Add CI/CD (+$1/month)
```bash
# 1. Create CodePipeline: GitHub → CodeBuild → ECS
# 2. Add automated testing stage
# 3. Blue/green deployments
```

**Production Total**: $382-471/month

## 📞 Support

### Common Issues

**ECS task fails to start**
```bash
# Check logs
aws logs tail /ecs/foxtrot-test --follow

# Common causes:
# - Database connection failed (check RDS_ENDPOINT in secrets)
# - Image pull failed (check ECR permissions)
# - Health check failed (check /health endpoint)
```

**Can't connect to RDS from local**
```bash
# RDS is in VPC, not publicly accessible
# To connect, use SSM Session Manager or temporary bastion host
```

**High costs**
```bash
# Check Cost Explorer
aws ce get-cost-and-usage \
  --time-period Start=2026-02-01,End=2026-02-06 \
  --granularity DAILY \
  --metrics BlendedCost

# Common culprits:
# - Data transfer (check if downloading large files)
# - CloudWatch Logs (rotate/delete old logs)
# - Stopped RDS (still charges for storage)
```

## 📚 Additional Resources

- [AWS ECS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [AWS Free Tier](https://aws.amazon.com/free/)
- [ECS Task Definition Parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)
- [RDS Best Practices](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.html)
