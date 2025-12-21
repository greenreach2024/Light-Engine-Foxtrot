# AWS Deployment Guide - Light Engine Foxtrot

Complete guide for deploying Light Engine Foxtrot to AWS Elastic Beanstalk with PostgreSQL RDS.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Manual Deployment Steps](#manual-deployment-steps)
4. [Environment Configuration](#environment-configuration)
5. [Database Setup](#database-setup)
6. [Secrets Management](#secrets-management)
7. [Monitoring and Alerts](#monitoring-and-alerts)
8. [Troubleshooting](#troubleshooting)
9. [Cost Optimization](#cost-optimization)
10. [Rollback Procedures](#rollback-procedures)

---

## Prerequisites

### Required Tools

```bash
# Install AWS CLI
brew install awscli

# Install EB CLI
pip install awsebcli

# Verify installations
aws --version
eb --version
```

### AWS Account Setup

1. **AWS Account**: You need an AWS account with billing enabled
2. **IAM User**: Create an IAM user with the following policies:
   - AWSElasticBeanstalkFullAccess
   - AmazonRDSFullAccess
   - AWSSecretsManagerReadWrite
   - CloudWatchFullAccess
   - IAMFullAccess (for role management)

3. **Configure AWS CLI**:
```bash
aws configure
# Enter:
# - AWS Access Key ID
# - AWS Secret Access Key
# - Default region: us-east-1
# - Default output format: json
```

### Verify Prerequisites

```bash
# Test AWS credentials
aws sts get-caller-identity

# Should return your account information
```

---

## Quick Start

The fastest way to deploy is using the automated deployment script:

```bash
# Make the script executable
chmod +x scripts/deploy-aws.sh

# Run deployment
./scripts/deploy-aws.sh
```

This script will:
1. Initialize Elastic Beanstalk application
2. Create RDS PostgreSQL database
3. Generate and store JWT secret
4. Store database password in Secrets Manager
5. Create and configure EB environment
6. Deploy the application
7. Set up CloudWatch alarms

**Duration**: 15-20 minutes (mostly RDS creation time)

---

## Manual Deployment Steps

If you prefer step-by-step control, follow these manual instructions.

### Step 1: Initialize Elastic Beanstalk

```bash
# Initialize EB in the project directory
cd /Users/petergilbert/Light-Engine-Foxtrot

eb init light-engine-foxtrot \
  --platform "Node.js 20 running on 64bit Amazon Linux 2023" \
  --region us-east-1
```

### Step 2: Create RDS Database

#### 2.1: Generate Database Credentials

```bash
# Generate secure password
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
echo "Database Password: $DB_PASSWORD"

# Save this password securely!
```

#### 2.2: Store Password in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name foxtrot/db-password \
  --description "PostgreSQL database password for Foxtrot production" \
  --secret-string "$DB_PASSWORD" \
  --region us-east-1
```

#### 2.3: Create DB Subnet Group

```bash
# Get subnet IDs from default VPC
SUBNET_IDS=$(aws ec2 describe-subnets \
  --region us-east-1 \
  --query 'Subnets[0:2].SubnetId' \
  --output text)

# Create subnet group
aws rds create-db-subnet-group \
  --db-subnet-group-name foxtrot-db-subnet-group \
  --db-subnet-group-description "Subnet group for Foxtrot RDS" \
  --subnet-ids $SUBNET_IDS \
  --region us-east-1
```

#### 2.4: Create Security Group

```bash
# Create RDS security group
DB_SG_ID=$(aws ec2 create-security-group \
  --group-name foxtrot-rds-sg \
  --description "Security group for Foxtrot RDS" \
  --region us-east-1 \
  --query 'GroupId' \
  --output text)

echo "RDS Security Group ID: $DB_SG_ID"
```

#### 2.5: Create RDS Instance

```bash
aws rds create-db-instance \
  --db-instance-identifier foxtrot-production-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 16.1 \
  --master-username foxtrot_admin \
  --master-user-password "$DB_PASSWORD" \
  --allocated-storage 20 \
  --storage-type gp3 \
  --db-name foxtrot_production \
  --vpc-security-group-ids $DB_SG_ID \
  --db-subnet-group-name foxtrot-db-subnet-group \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --preferred-maintenance-window "Mon:04:00-Mon:05:00" \
  --multi-az false \
  --publicly-accessible false \
  --storage-encrypted true \
  --region us-east-1

# Wait for RDS to be available (takes ~10 minutes)
aws rds wait db-instance-available \
  --db-instance-identifier foxtrot-production-db \
  --region us-east-1
```

#### 2.6: Get RDS Endpoint

```bash
DB_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier foxtrot-production-db \
  --region us-east-1 \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)

echo "RDS Endpoint: $DB_ENDPOINT"
```

### Step 3: Generate JWT Secret

```bash
# Generate JWT secret
JWT_SECRET=$(openssl rand -base64 64 | tr -d "\n")

# Store in Secrets Manager
aws secretsmanager create-secret \
  --name foxtrot/jwt-secret \
  --description "JWT secret for Foxtrot authentication" \
  --secret-string "$JWT_SECRET" \
  --region us-east-1
```

### Step 4: Create Elastic Beanstalk Environment

```bash
# Create environment
eb create foxtrot-production \
  --instance-type t3.small \
  --region us-east-1 \
  --envvars \
    NODE_ENV=production,\
    PORT=8091,\
    DB_ENABLED=true,\
    DB_HOST=$DB_ENDPOINT,\
    DB_PORT=5432,\
    DB_NAME=foxtrot_production,\
    DB_USER=foxtrot_admin,\
    RATE_LIMITING_ENABLED=true,\
    AUDIT_LOG_ENABLED=true,\
    CLOUDWATCH_ENABLED=true,\
    CLOUDWATCH_REGION=us-east-1
```

### Step 5: Configure IAM Roles

The EB instances need permissions to access Secrets Manager and CloudWatch:

```bash
# Attach Secrets Manager policy
aws iam attach-role-policy \
  --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite

# Attach CloudWatch policy
aws iam attach-role-policy \
  --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
```

### Step 6: Allow EB Instances to Connect to RDS

```bash
# Get EB security group
EB_SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*elasticbeanstalk*" \
  --region us-east-1 \
  --query 'SecurityGroups[0].GroupId' \
  --output text)

# Allow EB to connect to RDS
aws ec2 authorize-security-group-ingress \
  --group-id $DB_SG_ID \
  --protocol tcp \
  --port 5432 \
  --source-group $EB_SG_ID \
  --region us-east-1
```

### Step 7: Deploy Application

```bash
# Deploy current code
eb deploy foxtrot-production

# Monitor deployment
eb logs foxtrot-production --stream
```

### Step 8: Verify Deployment

```bash
# Get application URL
eb status foxtrot-production | grep CNAME

# Test health endpoint
APP_URL=$(eb status foxtrot-production | grep CNAME | awk '{print $2}')
curl https://$APP_URL/health
```

---

## Environment Configuration

### Environment Variables

All environment variables are configured in `.ebextensions/nodejs.config`:

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Node.js environment |
| `PORT` | `8091` | Application port |
| `DB_ENABLED` | `true` | Enable PostgreSQL |
| `DB_HOST` | Set by script | RDS endpoint |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `foxtrot_production` | Database name |
| `DB_USER` | `foxtrot_admin` | Database username |
| `DB_PASSWORD` | From Secrets Manager | Database password |
| `JWT_SECRET` | From Secrets Manager | JWT signing secret |
| `RATE_LIMITING_ENABLED` | `true` | Enable rate limiting |
| `AUDIT_LOG_ENABLED` | `true` | Enable audit logging |
| `CLOUDWATCH_ENABLED` | `true` | Enable CloudWatch metrics |
| `CLOUDWATCH_NAMESPACE` | `LightEngine/Foxtrot` | Metrics namespace |
| `CLOUDWATCH_REGION` | `us-east-1` | AWS region |

### Secrets from AWS Secrets Manager

Secrets are automatically retrieved on application startup via the pre-deploy hook:

- `foxtrot/jwt-secret` → `JWT_SECRET`
- `foxtrot/db-password` → `DB_PASSWORD`
- `foxtrot/square-access-token` → `SQUARE_ACCESS_TOKEN` (if exists)
- `foxtrot/square-location-id` → `SQUARE_LOCATION_ID` (if exists)

---

## Database Setup

### Initialize Database Schema

After deployment, run migrations:

```bash
# SSH into EB instance
eb ssh foxtrot-production

# Run Alembic migrations
cd /var/app/current
alembic upgrade head

# Exit SSH
exit
```

### Database Backups

Automatic backups are configured:
- **Backup Window**: 3:00-4:00 AM UTC
- **Retention**: 7 days
- **Maintenance Window**: Monday 4:00-5:00 AM UTC

### Manual Backup

```bash
# Create manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier foxtrot-production-db \
  --db-snapshot-identifier foxtrot-manual-$(date +%Y%m%d-%H%M%S) \
  --region us-east-1
```

---

## Secrets Management

### Store Square API Keys

```bash
# Store Square Access Token
aws secretsmanager create-secret \
  --name foxtrot/square-access-token \
  --description "Square API access token for Foxtrot" \
  --secret-string "YOUR_SQUARE_ACCESS_TOKEN" \
  --region us-east-1

# Store Square Location ID
aws secretsmanager create-secret \
  --name foxtrot/square-location-id \
  --description "Square Location ID for Foxtrot" \
  --secret-string "YOUR_SQUARE_LOCATION_ID" \
  --region us-east-1
```

### Rotate Secrets

```bash
# Update JWT secret
NEW_JWT_SECRET=$(openssl rand -base64 64 | tr -d "\n")
aws secretsmanager update-secret \
  --secret-id foxtrot/jwt-secret \
  --secret-string "$NEW_JWT_SECRET" \
  --region us-east-1

# Restart application to pick up new secret
eb restart foxtrot-production
```

### View Secrets

```bash
# Retrieve JWT secret
aws secretsmanager get-secret-value \
  --secret-id foxtrot/jwt-secret \
  --region us-east-1 \
  --query SecretString \
  --output text
```

---

## Monitoring and Alerts

### CloudWatch Metrics

The application publishes custom metrics to CloudWatch:

| Metric | Unit | Description |
|--------|------|-------------|
| `APIResponseTime` | Milliseconds | API response latency |
| `APIRequests` | Count | Total API requests |
| `APIErrors` | Count | API errors (status >= 400) |
| `DatabaseConnected` | Count | Database connection status |
| `DatabaseLatency` | Milliseconds | Database query latency |
| `MemoryUsed` | Megabytes | Memory usage |
| `MemoryPercent` | Percent | Memory usage percentage |

### CloudWatch Alarms

Create alarms to monitor application health:

#### High Error Rate (>5%)

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-high-error-rate \
  --alarm-description "Alert when API error rate exceeds 5%" \
  --namespace LightEngine/Foxtrot \
  --metric-name APIErrors \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:foxtrot-alerts \
  --region us-east-1
```

#### Slow Response Time (P95 > 1s)

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-slow-response \
  --alarm-description "Alert when P95 response time exceeds 1 second" \
  --namespace LightEngine/Foxtrot \
  --metric-name APIResponseTime \
  --extended-statistic p95 \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:foxtrot-alerts \
  --region us-east-1
```

#### Database Disconnection

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-database-disconnected \
  --alarm-description "Alert when database connection fails" \
  --namespace LightEngine/Foxtrot \
  --metric-name DatabaseConnected \
  --statistic Average \
  --period 60 \
  --evaluation-periods 3 \
  --threshold 1 \
  --comparison-operator LessThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:foxtrot-alerts \
  --region us-east-1
```

#### High Memory Usage (>80%)

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name foxtrot-high-memory \
  --alarm-description "Alert when memory usage exceeds 80%" \
  --namespace LightEngine/Foxtrot \
  --metric-name MemoryPercent \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:foxtrot-alerts \
  --region us-east-1
```

### SNS Topic for Alerts

```bash
# Create SNS topic
SNS_TOPIC_ARN=$(aws sns create-topic \
  --name foxtrot-alerts \
  --region us-east-1 \
  --query 'TopicArn' \
  --output text)

# Subscribe email to topic
aws sns subscribe \
  --topic-arn $SNS_TOPIC_ARN \
  --protocol email \
  --notification-endpoint your-email@example.com \
  --region us-east-1

# Confirm subscription via email
```

### CloudWatch Dashboard

Create a dashboard to visualize metrics:

```bash
aws cloudwatch put-dashboard \
  --dashboard-name foxtrot-production \
  --dashboard-body file://cloudwatch-dashboard.json \
  --region us-east-1
```

See [CloudWatch Dashboard Template](#cloudwatch-dashboard-template) below.

---

## Troubleshooting

### Check Application Logs

```bash
# Stream logs in real-time
eb logs foxtrot-production --stream

# Download all logs
eb logs foxtrot-production --all
```

### Common Issues

#### 1. Database Connection Failures

**Symptoms**: Application health check fails, logs show database connection errors

**Solutions**:
```bash
# Check RDS status
aws rds describe-db-instances \
  --db-instance-identifier foxtrot-production-db \
  --region us-east-1 \
  --query 'DBInstances[0].DBInstanceStatus'

# Verify security group rules
aws ec2 describe-security-groups \
  --group-ids $DB_SG_ID \
  --region us-east-1

# Test database connectivity from EB instance
eb ssh foxtrot-production
psql -h $DB_ENDPOINT -U foxtrot_admin -d foxtrot_production
```

#### 2. Secrets Manager Access Denied

**Symptoms**: Application fails to start, logs show "AccessDenied" for Secrets Manager

**Solution**:
```bash
# Verify IAM role has correct policy
aws iam list-attached-role-policies \
  --role-name aws-elasticbeanstalk-ec2-role

# If missing, attach policy
aws iam attach-role-policy \
  --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
```

#### 3. High Memory Usage

**Symptoms**: Application becomes slow, CloudWatch shows >90% memory usage

**Solution**:
```bash
# Scale up instance type
eb scale foxtrot-production --instance-type t3.medium

# Or increase auto-scaling
eb setenv MAX_INSTANCES=4
```

#### 4. Deployment Failures

**Symptoms**: `eb deploy` fails with timeout or health check errors

**Solutions**:
```bash
# Check deployment logs
eb logs foxtrot-production

# Increase health check timeout
eb config
# Edit: aws:elasticbeanstalk:environment:process:default:HealthCheckTimeout: 10

# Roll back to previous version
eb deploy --version <previous-version>
```

### SSH Access

```bash
# SSH into EB instance
eb ssh foxtrot-production

# Check application status
sudo systemctl status web

# View application logs
tail -f /var/log/nodejs/nodejs.log

# Check environment variables
printenv | grep -E '(DB_|JWT_|CLOUDWATCH_)'
```

---

## Cost Optimization

### Estimated Monthly Costs (Pilot Deployment)

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| **Elastic Beanstalk** | t3.small (1 instance) | ~$15 |
| **RDS PostgreSQL** | db.t3.micro (20GB) | ~$16 |
| **CloudWatch** | 7 custom metrics, 4 alarms | ~$1 |
| **Secrets Manager** | 3 secrets | ~$1 |
| **Data Transfer** | Minimal (< 1GB) | ~$1 |
| **Total** | | **~$34/month** |

### Free Tier Eligibility

If you're within the AWS Free Tier (first 12 months):
- **EC2**: 750 hours/month of t2.micro or t3.micro (covers EB instance)
- **RDS**: 750 hours/month of db.t2.micro or db.t3.micro
- **CloudWatch**: 10 custom metrics, 10 alarms free

**Estimated Free Tier Cost**: ~$2-5/month

### Cost Reduction Strategies

1. **Use t3.micro Instead of t3.small**: Saves ~$8/month
   ```bash
   eb scale foxtrot-production --instance-type t3.micro
   ```

2. **Reduce RDS Backup Retention**: Save on storage costs
   ```bash
   aws rds modify-db-instance \
     --db-instance-identifier foxtrot-production-db \
     --backup-retention-period 3 \
     --region us-east-1
   ```

3. **Disable Multi-AZ**: Already disabled in our configuration

4. **Use Spot Instances**: Not recommended for production

5. **Schedule Non-Production Environments**: Stop dev/staging when not in use
   ```bash
   # Stop environment
   eb config foxtrot-staging --setting EnvironmentType=SingleInstance

   # Scale down to 0
   aws elasticbeanstalk update-environment \
     --environment-name foxtrot-staging \
     --option-settings Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=0
   ```

---

## Rollback Procedures

### Rollback to Previous Version

```bash
# List available versions
eb appversion

# Rollback to specific version
eb deploy --version <version-label>

# Example
eb deploy --version foxtrot-v1.2.3
```

### Emergency Rollback

If the application is completely broken:

```bash
# Stop environment
eb abort foxtrot-production

# Deploy last known good version
eb deploy --version <last-good-version>

# Restart environment
eb restart foxtrot-production
```

### Database Rollback

```bash
# Restore from automatic backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier foxtrot-production-db-restored \
  --db-snapshot-identifier <snapshot-id> \
  --region us-east-1

# Point application to restored database
eb setenv DB_HOST=<restored-db-endpoint>
```

---

## CloudWatch Dashboard Template

Create `cloudwatch-dashboard.json`:

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["LightEngine/Foxtrot", "APIResponseTime", {"stat": "Average"}],
          ["...", {"stat": "p95"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "API Response Time",
        "yAxis": {
          "left": {
            "label": "Milliseconds"
          }
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["LightEngine/Foxtrot", "APIRequests", {"stat": "Sum"}],
          [".", "APIErrors", {"stat": "Sum"}]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "us-east-1",
        "title": "API Requests & Errors"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["LightEngine/Foxtrot", "DatabaseLatency", {"stat": "Average"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Database Latency"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["LightEngine/Foxtrot", "MemoryPercent", {"stat": "Average"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Memory Usage",
        "yAxis": {
          "left": {
            "min": 0,
            "max": 100
          }
        }
      }
    }
  ]
}
```

---

## Next Steps

After successful deployment:

1. ✅ Subscribe to SNS alerts
2. ✅ Configure Square API keys in Secrets Manager
3. ✅ Run database migrations
4. ✅ Test all API endpoints
5. ✅ Configure custom domain (Route 53)
6. ✅ Set up WAF rules for security
7. ✅ Configure backups and retention
8. ✅ Document operational procedures
9. ✅ Set up monitoring dashboard
10. ✅ Perform load testing

---

## Support

For issues or questions:

1. Check application logs: `eb logs foxtrot-production`
2. Review CloudWatch metrics and alarms
3. Consult AWS documentation: https://docs.aws.amazon.com/elasticbeanstalk/
4. Contact support: support@lightenginefoxtrot.com

---

**Last Updated**: Task #10 - AWS Infrastructure Deployment  
**Version**: 1.0.0  
**Author**: GitHub Copilot
