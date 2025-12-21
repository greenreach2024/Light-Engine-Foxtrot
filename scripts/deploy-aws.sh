#!/bin/bash
# AWS Elastic Beanstalk Deployment Script
# Deploys Light Engine Foxtrot to production with PostgreSQL RDS

set -e

echo "=========================================="
echo "Light Engine Foxtrot - AWS Deployment"
echo "=========================================="

# Configuration
APP_NAME="light-engine-foxtrot"
ENV_NAME="foxtrot-production"
REGION="us-east-1"
PLATFORM="Node.js 20 running on 64bit Amazon Linux 2023"
INSTANCE_TYPE="t3.small"  # Upgrade from t3.micro for better performance
DB_INSTANCE_CLASS="db.t3.micro"
DB_ENGINE="postgres"
DB_ENGINE_VERSION="16.1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
print_step() {
    echo -e "\n${GREEN}==>${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}WARNING:${NC} $1"
}

print_error() {
    echo -e "${RED}ERROR:${NC} $1"
}

# Check prerequisites
print_step "Checking prerequisites..."

if ! command -v aws &> /dev/null; then
    print_error "AWS CLI not installed. Install with: brew install awscli"
    exit 1
fi

if ! command -v eb &> /dev/null; then
    print_error "EB CLI not installed. Install with: pip install awsebcli"
    exit 1
fi

if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials not configured. Run: aws configure"
    exit 1
fi

print_step "Prerequisites check passed"

# Step 1: Initialize Elastic Beanstalk application
print_step "Step 1: Initializing Elastic Beanstalk application..."

if [ ! -f ".elasticbeanstalk/config.yml" ]; then
    eb init $APP_NAME \
        --platform "$PLATFORM" \
        --region $REGION
    echo "✓ EB application initialized"
else
    echo "✓ EB application already initialized"
fi

# Step 2: Create RDS database
print_step "Step 2: Creating RDS PostgreSQL database..."

DB_NAME="foxtrot_production"
DB_USERNAME="foxtrot_admin"
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)

echo "Database credentials:"
echo "  Name: $DB_NAME"
echo "  Username: $DB_USERNAME"
echo "  Password: $DB_PASSWORD"
echo ""
print_warning "Save these credentials securely!"

# Store DB password in Secrets Manager
aws secretsmanager create-secret \
    --name foxtrot/db-password \
    --description "PostgreSQL database password for Foxtrot production" \
    --secret-string "$DB_PASSWORD" \
    --region $REGION \
    2>/dev/null || \
aws secretsmanager update-secret \
    --secret-id foxtrot/db-password \
    --secret-string "$DB_PASSWORD" \
    --region $REGION

echo "✓ Database password stored in Secrets Manager"

# Create DB subnet group if needed
aws rds create-db-subnet-group \
    --db-subnet-group-name foxtrot-db-subnet-group \
    --db-subnet-group-description "Subnet group for Foxtrot RDS" \
    --subnet-ids $(aws ec2 describe-subnets --region $REGION --query 'Subnets[0:2].SubnetId' --output text) \
    --region $REGION \
    2>/dev/null || echo "✓ DB subnet group already exists"

# Create security group for RDS
DB_SG_ID=$(aws ec2 create-security-group \
    --group-name foxtrot-rds-sg \
    --description "Security group for Foxtrot RDS" \
    --region $REGION \
    --query 'GroupId' \
    --output text \
    2>/dev/null || \
aws ec2 describe-security-groups \
    --group-names foxtrot-rds-sg \
    --region $REGION \
    --query 'SecurityGroups[0].GroupId' \
    --output text)

echo "✓ RDS security group: $DB_SG_ID"

# Allow EB instances to connect to RDS
aws ec2 authorize-security-group-ingress \
    --group-id $DB_SG_ID \
    --protocol tcp \
    --port 5432 \
    --source-group $(aws ec2 describe-security-groups --filters "Name=group-name,Values=*elasticbeanstalk*" --region $REGION --query 'SecurityGroups[0].GroupId' --output text) \
    --region $REGION \
    2>/dev/null || echo "✓ Security group rule already exists"

# Create RDS instance
print_step "Creating RDS PostgreSQL instance (this takes ~10 minutes)..."

aws rds create-db-instance \
    --db-instance-identifier foxtrot-production-db \
    --db-instance-class $DB_INSTANCE_CLASS \
    --engine $DB_ENGINE \
    --engine-version $DB_ENGINE_VERSION \
    --master-username $DB_USERNAME \
    --master-user-password "$DB_PASSWORD" \
    --allocated-storage 20 \
    --storage-type gp3 \
    --db-name $DB_NAME \
    --vpc-security-group-ids $DB_SG_ID \
    --db-subnet-group-name foxtrot-db-subnet-group \
    --backup-retention-period 7 \
    --preferred-backup-window "03:00-04:00" \
    --preferred-maintenance-window "Mon:04:00-Mon:05:00" \
    --multi-az false \
    --publicly-accessible false \
    --storage-encrypted true \
    --region $REGION \
    2>/dev/null || echo "✓ RDS instance already exists"

echo "Waiting for RDS instance to become available..."
aws rds wait db-instance-available \
    --db-instance-identifier foxtrot-production-db \
    --region $REGION

# Get RDS endpoint
DB_ENDPOINT=$(aws rds describe-db-instances \
    --db-instance-identifier foxtrot-production-db \
    --region $REGION \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text)

echo "✓ RDS instance ready: $DB_ENDPOINT"

# Step 3: Generate and store JWT secret
print_step "Step 3: Generating JWT secret..."

JWT_SECRET=$(openssl rand -base64 64 | tr -d "\n")

aws secretsmanager create-secret \
    --name foxtrot/jwt-secret \
    --description "JWT secret for Foxtrot authentication" \
    --secret-string "$JWT_SECRET" \
    --region $REGION \
    2>/dev/null || \
aws secretsmanager update-secret \
    --secret-id foxtrot/jwt-secret \
    --secret-string "$JWT_SECRET" \
    --region $REGION

echo "✓ JWT secret stored in Secrets Manager"

# Step 4: Create environment
print_step "Step 4: Creating Elastic Beanstalk environment..."

# Create environment configuration file
cat > /tmp/eb-env-config.json << EOF
[
  {
    "Namespace": "aws:autoscaling:launchconfiguration",
    "OptionName": "InstanceType",
    "Value": "$INSTANCE_TYPE"
  },
  {
    "Namespace": "aws:autoscaling:launchconfiguration",
    "OptionName": "IamInstanceProfile",
    "Value": "aws-elasticbeanstalk-ec2-role"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "NODE_ENV",
    "Value": "production"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "PORT",
    "Value": "8091"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "DB_ENABLED",
    "Value": "true"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "DB_HOST",
    "Value": "$DB_ENDPOINT"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "DB_PORT",
    "Value": "5432"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "DB_NAME",
    "Value": "$DB_NAME"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "DB_USER",
    "Value": "$DB_USERNAME"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "RATE_LIMITING_ENABLED",
    "Value": "true"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "AUDIT_LOG_ENABLED",
    "Value": "true"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "CLOUDWATCH_ENABLED",
    "Value": "true"
  },
  {
    "Namespace": "aws:elasticbeanstalk:application:environment",
    "OptionName": "CLOUDWATCH_REGION",
    "Value": "$REGION"
  }
]
EOF

if ! eb list | grep -q "$ENV_NAME"; then
    eb create $ENV_NAME \
        --instance-type $INSTANCE_TYPE \
        --envvars-file /tmp/eb-env-config.json \
        --region $REGION
    echo "✓ Environment created"
else
    echo "✓ Environment already exists"
fi

# Step 5: Configure IAM roles
print_step "Step 5: Configuring IAM roles..."

# Attach policies to EB instance role
aws iam attach-role-policy \
    --role-name aws-elasticbeanstalk-ec2-role \
    --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite \
    2>/dev/null || echo "✓ Secrets Manager policy already attached"

aws iam attach-role-policy \
    --role-name aws-elasticbeanstalk-ec2-role \
    --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy \
    2>/dev/null || echo "✓ CloudWatch policy already attached"

echo "✓ IAM roles configured"

# Step 6: Deploy application
print_step "Step 6: Deploying application..."

# Create deployment package
print_step "Creating deployment package..."
zip -r foxtrot-deploy.zip . \
    -x "*.git*" \
    -x "*node_modules*" \
    -x "*.aws-backup*" \
    -x "*backups*" \
    -x "*logs*" \
    -x "*data*" \
    -x "*.ebextensions/*" \
    -x "*tests*"

# Deploy
eb deploy $ENV_NAME --staged

echo "✓ Application deployed"

# Step 7: Create CloudWatch alarms
print_step "Step 7: Setting up CloudWatch alarms..."

# Get SNS topic ARN (create if doesn't exist)
SNS_TOPIC_ARN=$(aws sns create-topic \
    --name foxtrot-alerts \
    --region $REGION \
    --query 'TopicArn' \
    --output text)

echo "✓ SNS topic: $SNS_TOPIC_ARN"

print_warning "Subscribe to SNS topic for alerts:"
echo "  aws sns subscribe --topic-arn $SNS_TOPIC_ARN --protocol email --notification-endpoint your-email@example.com"

# Create alarms
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
    --alarm-actions $SNS_TOPIC_ARN \
    --region $REGION

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
    --alarm-actions $SNS_TOPIC_ARN \
    --region $REGION

echo "✓ CloudWatch alarms created"

# Step 8: Summary
print_step "Deployment Summary"
echo "=========================================="
echo ""
echo "Application: $APP_NAME"
echo "Environment: $ENV_NAME"
echo "Region: $REGION"
echo ""
echo "Database:"
echo "  Endpoint: $DB_ENDPOINT"
echo "  Name: $DB_NAME"
echo "  Username: $DB_USERNAME"
echo "  Password: (stored in Secrets Manager: foxtrot/db-password)"
echo ""
echo "Secrets Manager:"
echo "  JWT Secret: foxtrot/jwt-secret"
echo "  DB Password: foxtrot/db-password"
echo ""
echo "CloudWatch:"
echo "  Metrics Namespace: LightEngine/Foxtrot"
echo "  SNS Topic: $SNS_TOPIC_ARN"
echo ""
echo "Next Steps:"
echo "  1. Subscribe to SNS alerts:"
echo "     aws sns subscribe --topic-arn $SNS_TOPIC_ARN --protocol email --notification-endpoint your-email@example.com"
echo ""
echo "  2. Get application URL:"
echo "     eb status $ENV_NAME | grep CNAME"
echo ""
echo "  3. Test health endpoint:"
echo "     curl https://your-app-url/health"
echo ""
echo "  4. Monitor logs:"
echo "     eb logs $ENV_NAME"
echo ""
echo "=========================================="
echo -e "${GREEN}Deployment Complete!${NC}"
echo "=========================================="
