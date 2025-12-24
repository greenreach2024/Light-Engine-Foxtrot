# AWS Deployment Guide

Complete guide for deploying Light Engine Foxtrot to AWS production infrastructure.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Amazon CloudFront (Optional)              │
│                          CDN / WAF                            │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│              Application Load Balancer (ALB)                 │
│                  SSL/TLS Termination                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Listener Rules:                                      │   │
│  │ - *.greenreach.io -> Main App Target Group          │   │
│  │ - central.greenreach.io -> Central Target Group     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────┬──────────────────────┬─────────────────────────┘
              │                      │
    ┌─────────▼─────────┐  ┌────────▼──────────┐
    │  Main App Tasks   │  │  Central Tasks    │
    │  ECS Fargate      │  │  ECS Fargate      │
    │  (2-10 instances) │  │  (1-2 instances)  │
    │  Auto-scaling     │  │                   │
    └─────────┬─────────┘  └────────┬──────────┘
              │                      │
              └──────────┬───────────┘
                         │
              ┌──────────▼───────────┐
              │   RDS PostgreSQL     │
              │   Multi-AZ           │
              │   Encrypted          │
              │   Automated Backups  │
              └──────────────────────┘
```

## Prerequisites

### 1. AWS Account Setup
- AWS Account with admin access
- AWS CLI installed and configured
- Docker installed locally
- Domain name registered (e.g., greenreach.io)

### 2. Required Tools
```bash
# Install AWS CLI
brew install awscli  # macOS
# or: https://aws.amazon.com/cli/

# Install Docker
# https://www.docker.com/get-started

# Configure AWS credentials
aws configure
```

### 3. Domain and SSL
- Domain registered with registrar (Route 53, GoDaddy, etc.)
- Access to DNS management
- SSL certificate will be auto-requested via ACM

## Deployment Steps

### Quick Deploy (Automated)

```bash
# Set environment variables
export AWS_REGION=us-east-1
export DOMAIN_NAME=greenreach.io

# Run deployment script
./aws-infrastructure/deploy.sh production
```

The script will:
1. ✅ Validate AWS credentials
2. ✅ Request SSL certificate (requires DNS validation)
3. ✅ Create ECR repositories
4. ✅ Build and push Docker images
5. ✅ Generate secure database password
6. ✅ Deploy CloudFormation stack
7. ✅ Configure auto-scaling
8. ✅ Output deployment information

### Manual Deploy (Step-by-Step)

#### Step 1: Request SSL Certificate

```bash
aws acm request-certificate \
  --region us-east-1 \
  --domain-name "*.greenreach.io" \
  --subject-alternative-names "greenreach.io" \
  --validation-method DNS
```

Add DNS validation records to your domain, then wait for validation:

```bash
aws acm wait certificate-validated \
  --region us-east-1 \
  --certificate-arn arn:aws:acm:...
```

#### Step 2: Create ECR Repositories

```bash
aws ecr create-repository --repository-name light-engine
aws ecr create-repository --repository-name light-engine-central
```

#### Step 3: Build and Push Docker Images

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build and push main app
docker build -t light-engine:latest -f Dockerfile .
docker tag light-engine:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/light-engine:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/light-engine:latest

# Build and push central dashboard
docker build -t light-engine-central:latest -f greenreach-central-app/Dockerfile greenreach-central-app/
docker tag light-engine-central:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/light-engine-central:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/light-engine-central:latest
```

#### Step 4: Deploy CloudFormation Stack

```bash
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name production-light-engine-stack \
  --template-file aws-infrastructure/cloudformation-stack.yaml \
  --parameter-overrides \
    Environment=production \
    DBPassword="$(openssl rand -base64 32)" \
    DomainName=greenreach.io \
    CertificateArn=arn:aws:acm:... \
  --capabilities CAPABILITY_IAM
```

#### Step 5: Configure DNS

Get the ALB DNS name:

```bash
aws cloudformation describe-stacks \
  --stack-name production-light-engine-stack \
  --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDNS'].OutputValue" \
  --output text
```

Add DNS records:
- `*.greenreach.io` CNAME to ALB DNS
- `central.greenreach.io` CNAME to ALB DNS

#### Step 6: Initialize Database

Connect to RDS and run migrations:

```bash
# Get database endpoint
aws cloudformation describe-stacks \
  --stack-name production-light-engine-stack \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" \
  --output text

# Connect via bastion or from ECS task
psql postgresql://lightengine:PASSWORD@DB_ENDPOINT:5432/light_engine

# Run migrations
\i greenreach-central-app/schema.sql
```

## Infrastructure Components

### VPC Configuration
- **CIDR**: 10.0.0.0/16
- **Public Subnets**: 2 (for ALB) - 10.0.1.0/24, 10.0.2.0/24
- **Private Subnets**: 2 (for ECS) - 10.0.10.0/24, 10.0.11.0/24
- **Database Subnets**: 2 (for RDS) - 10.0.20.0/24, 10.0.21.0/24
- **NAT Gateway**: 1 (high availability)
- **Internet Gateway**: 1

### ECS Cluster
- **Compute**: Fargate (serverless containers)
- **Main App**: 2-10 tasks, auto-scaling on CPU
- **Central Dashboard**: 1-2 tasks
- **CPU**: 1 vCPU per main task, 0.5 vCPU per central task
- **Memory**: 2GB per main task, 1GB per central task

### RDS PostgreSQL
- **Engine**: PostgreSQL 14.10
- **Instance**: db.t3.medium
- **Storage**: 100GB GP3, encrypted
- **Backup**: 30-day retention, daily at 3 AM UTC
- **Multi-AZ**: Enabled for high availability
- **Maintenance**: Sunday 4-5 AM UTC

### Load Balancer
- **Type**: Application Load Balancer (ALB)
- **Scheme**: Internet-facing
- **SSL/TLS**: Terminated at ALB
- **Health Checks**: /health endpoint, 30s interval
- **Target Groups**: Main app (port 3000), Central (port 3100)

### Security Groups
- **ALB SG**: Allows 80/443 from internet
- **ECS SG**: Allows 3000/3100 from ALB only
- **RDS SG**: Allows 5432 from ECS only

### S3 Buckets
- **Data Bucket**: Application data, versioned
- **Backup Bucket**: Database backups, lifecycle to Glacier after 30 days

### Secrets Manager
- **Database Credentials**: Auto-rotated
- **Admin Token**: For GreenReach Central access
- **License Keys**: RSA private key for signing

## Monitoring & Logging

### CloudWatch Logs
- **Main App**: `/ecs/production/light-engine/main`
- **Central**: `/ecs/production/light-engine/central`
- **Retention**: 30 days

### CloudWatch Alarms (Recommended)
```bash
# High CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name light-engine-high-cpu \
  --alarm-description "Alert when CPU exceeds 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2

# Database connections alarm
aws cloudwatch put-metric-alarm \
  --alarm-name light-engine-db-connections \
  --alarm-description "Alert when DB connections exceed 80" \
  --metric-name DatabaseConnections \
  --namespace AWS/RDS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold
```

### Container Insights
Enabled on ECS cluster for detailed metrics:
- Container CPU/memory usage
- Network traffic
- Task counts

## Auto-Scaling Configuration

### ECS Service Auto-Scaling
- **Metric**: CPU Utilization
- **Target**: 70%
- **Min Capacity**: 2 tasks
- **Max Capacity**: 10 tasks
- **Scale Out**: 60 seconds cooldown
- **Scale In**: 300 seconds cooldown

### RDS Auto-Scaling (Storage)
- Automatically increases storage when < 10% free
- Max storage: 1TB

## Backup & Disaster Recovery

### Database Backups
- **Automated**: Daily snapshots, 30-day retention
- **Manual**: On-demand snapshots before major changes
- **Cross-Region**: Optional, configure in RDS

### Application Data
- **S3 Versioning**: Enabled on data bucket
- **Lifecycle Policy**: Archive to Glacier after 90 days

### Disaster Recovery Plan
1. **RDS Restore**: Point-in-time recovery up to 5 minutes ago
2. **S3 Restore**: Versioning allows rollback
3. **ECS Rollback**: Previous task definitions retained
4. **Infrastructure**: CloudFormation stack versioned in Git

## CI/CD Pipeline (Optional)

### CodePipeline Setup
```bash
# Create CodePipeline
aws codepipeline create-pipeline --cli-input-json file://pipeline.json

# Pipeline stages:
# 1. Source: GitHub/CodeCommit
# 2. Build: CodeBuild (using buildspec.yml)
# 3. Deploy: ECS rolling update
```

### buildspec.yml
Already configured in repository - builds Docker images and pushes to ECR.

## Cost Optimization

### Fargate Spot
- 70% discount on Fargate pricing
- Configured in capacity provider strategy
- Mix of Fargate (base) and Fargate Spot (burst)

### Reserved Instances
- RDS Reserved Instance: Save 40-60%
- Commit to 1-year term for production database

### S3 Lifecycle
- Move old backups to Glacier: Save 90%
- Delete old logs after 90 days

### Estimated Monthly Cost (Production)
- **ECS Fargate**: $50-150 (2-10 tasks)
- **RDS db.t3.medium Multi-AZ**: $140
- **ALB**: $25
- **Data Transfer**: $20-50
- **S3**: $10-20
- **Secrets Manager**: $2
- **Total**: ~$250-400/month

## Security Hardening

### Network Security
- [x] Private subnets for ECS and RDS
- [x] Security groups with least privilege
- [x] NAT Gateway for outbound-only internet
- [x] No public IPs on ECS tasks or RDS

### Data Security
- [x] RDS encryption at rest (AES-256)
- [x] S3 bucket encryption
- [x] SSL/TLS in transit (ALB)
- [x] Secrets in Secrets Manager (not environment variables)

### IAM Security
- [x] Task execution role (pull images, read secrets)
- [x] Task role (application permissions)
- [x] Least privilege policies
- [x] No root users in containers

### Application Security
- [x] Non-root container user (nodejs:1001)
- [x] Read-only root filesystem (optional)
- [x] Health checks
- [x] WAF rules (optional, add to ALB)

## Troubleshooting

### ECS Tasks Not Starting
```bash
# Check task logs
aws logs tail /ecs/production/light-engine/main --follow

# Check task events
aws ecs describe-tasks \
  --cluster production-light-engine-cluster \
  --tasks TASK_ARN
```

### Database Connection Issues
```bash
# Verify security group allows ECS -> RDS
aws ec2 describe-security-groups --group-ids sg-xxx

# Test from ECS task
aws ecs execute-command \
  --cluster production-light-engine-cluster \
  --task TASK_ARN \
  --container app \
  --interactive \
  --command "/bin/sh"

# Inside container:
nc -zv DB_ENDPOINT 5432
```

### High CPU/Memory
```bash
# Scale up manually
aws ecs update-service \
  --cluster production-light-engine-cluster \
  --service production-main-service \
  --desired-count 5

# Increase task resources
# Edit CloudFormation stack, update Cpu/Memory parameters
```

### SSL Certificate Issues
```bash
# Check certificate status
aws acm describe-certificate --certificate-arn ARN

# Renew certificate (auto-renewal should handle this)
# ACM automatically renews 60 days before expiration
```

## Maintenance

### Database Maintenance
- Automated minor version upgrades enabled
- Major version upgrades: manual, test in staging first
- Maintenance window: Sunday 4-5 AM UTC

### Security Patches
- ECS Fargate: AWS patches underlying infrastructure
- Container images: Rebuild monthly with latest base images
- Dependencies: `npm audit fix` and redeploy

### Monitoring Checklist
- [ ] Daily: Check CloudWatch dashboard
- [ ] Weekly: Review logs for errors
- [ ] Monthly: Review costs and optimize
- [ ] Monthly: Test disaster recovery
- [ ] Quarterly: Security audit

## Scaling for Growth

### Horizontal Scaling
Current: 2-10 tasks
- Increase max capacity in auto-scaling
- Add more AZs for better distribution

### Vertical Scaling
Current: 1 vCPU, 2GB RAM
- Increase to 2 vCPU, 4GB if needed
- Monitor memory usage in CloudWatch

### Database Scaling
Current: db.t3.medium
- Upgrade to db.m5.large for more CPU
- Add read replicas for read-heavy workloads
- Consider Aurora PostgreSQL for elasticity

### Multi-Region
For global distribution:
- Deploy stack in multiple regions
- Route 53 latency-based routing
- Cross-region RDS replication

## Support

### AWS Support Plans
- **Developer**: $29/month, business hours
- **Business**: $100/month, 24/7 support
- **Enterprise**: $15,000/month, TAM

### Documentation
- [AWS ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/)
- [RDS Security](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.html)
- [CloudFormation Reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/)

---

**Deployment Status**: ✅ Production-ready infrastructure  
**Last Updated**: December 2025  
**Maintained By**: GreenReach Development Team
