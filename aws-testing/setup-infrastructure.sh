#!/bin/bash
# AWS Testing Environment Setup
# Cost: ~$32-59/month (with free tier)
# Single AZ, minimal redundancy, public subnets (no NAT Gateway)

set -euo pipefail

echo "=========================================="
echo "Light Engine Foxtrot - AWS Testing Setup"
echo "=========================================="
echo ""

# Configuration
REGION="${AWS_REGION:-us-east-1}"
PROJECT="foxtrot-test"
VPC_CIDR="10.0.0.0/16"
PUBLIC_SUBNET_1_CIDR="10.0.1.0/24"
PUBLIC_SUBNET_2_CIDR="10.0.2.0/24"

echo "Region: $REGION"
echo "Project: $PROJECT"
echo ""

# Check AWS CLI credentials
echo "✓ Checking AWS credentials..."
aws sts get-caller-identity > /dev/null || {
    echo "❌ AWS credentials not configured. Run: aws configure"
    exit 1
}

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "  Account ID: $ACCOUNT_ID"
echo ""

# Create VPC with public subnets (no NAT Gateway for cost savings)
echo "1️⃣  Creating VPC..."
VPC_ID=$(aws ec2 create-vpc \
    --cidr-block $VPC_CIDR \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$PROJECT-vpc}]" \
    --query 'Vpc.VpcId' \
    --output text \
    --region $REGION)
echo "  VPC ID: $VPC_ID"

# Enable DNS hostnames
aws ec2 modify-vpc-attribute \
    --vpc-id $VPC_ID \
    --enable-dns-hostnames \
    --region $REGION

# Create Internet Gateway
echo "  Creating Internet Gateway..."
IGW_ID=$(aws ec2 create-internet-gateway \
    --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$PROJECT-igw}]" \
    --query 'InternetGateway.InternetGatewayId' \
    --output text \
    --region $REGION)
aws ec2 attach-internet-gateway \
    --vpc-id $VPC_ID \
    --internet-gateway-id $IGW_ID \
    --region $REGION
echo "  IGW ID: $IGW_ID"

# Create public subnets (2 for Multi-AZ ALB requirement)
echo "  Creating public subnets..."
SUBNET_1=$(aws ec2 create-subnet \
    --vpc-id $VPC_ID \
    --cidr-block $PUBLIC_SUBNET_1_CIDR \
    --availability-zone ${REGION}a \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-public-1a}]" \
    --query 'Subnet.SubnetId' \
    --output text \
    --region $REGION)
echo "  Subnet 1: $SUBNET_1 (${REGION}a)"

SUBNET_2=$(aws ec2 create-subnet \
    --vpc-id $VPC_ID \
    --cidr-block $PUBLIC_SUBNET_2_CIDR \
    --availability-zone ${REGION}b \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-public-1b}]" \
    --query 'Subnet.SubnetId' \
    --output text \
    --region $REGION)
echo "  Subnet 2: $SUBNET_2 (${REGION}b)"

# Enable auto-assign public IPs
aws ec2 modify-subnet-attribute \
    --subnet-id $SUBNET_1 \
    --map-public-ip-on-launch \
    --region $REGION
aws ec2 modify-subnet-attribute \
    --subnet-id $SUBNET_2 \
    --map-public-ip-on-launch \
    --region $REGION

# Create and attach route table
echo "  Creating route table..."
RTB_ID=$(aws ec2 create-route-table \
    --vpc-id $VPC_ID \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$PROJECT-public}]" \
    --query 'RouteTable.RouteTableId' \
    --output text \
    --region $REGION)
aws ec2 create-route \
    --route-table-id $RTB_ID \
    --destination-cidr-block 0.0.0.0/0 \
    --gateway-id $IGW_ID \
    --region $REGION > /dev/null
aws ec2 associate-route-table \
    --route-table-id $RTB_ID \
    --subnet-id $SUBNET_1 \
    --region $REGION > /dev/null
aws ec2 associate-route-table \
    --route-table-id $RTB_ID \
    --subnet-id $SUBNET_2 \
    --region $REGION > /dev/null
echo "  Route Table: $RTB_ID"
echo ""

# Create Security Groups
echo "2️⃣  Creating security groups..."

# ECS Security Group
ECS_SG=$(aws ec2 create-security-group \
    --group-name "$PROJECT-ecs" \
    --description "ECS Fargate tasks" \
    --vpc-id $VPC_ID \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$PROJECT-ecs}]" \
    --query 'GroupId' \
    --output text \
    --region $REGION)
echo "  ECS SG: $ECS_SG"

# Allow HTTP/HTTPS from anywhere (testing environment)
aws ec2 authorize-security-group-ingress \
    --group-id $ECS_SG \
    --protocol tcp \
    --port 8091 \
    --cidr 0.0.0.0/0 \
    --region $REGION || true
aws ec2 authorize-security-group-ingress \
    --group-id $ECS_SG \
    --protocol tcp \
    --port 8000 \
    --cidr 0.0.0.0/0 \
    --region $REGION || true

# RDS Security Group
RDS_SG=$(aws ec2 create-security-group \
    --group-name "$PROJECT-rds" \
    --description "RDS PostgreSQL" \
    --vpc-id $VPC_ID \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$PROJECT-rds}]" \
    --query 'GroupId' \
    --output text \
    --region $REGION)
echo "  RDS SG: $RDS_SG"

# Allow PostgreSQL from ECS
aws ec2 authorize-security-group-ingress \
    --group-id $RDS_SG \
    --protocol tcp \
    --port 5432 \
    --source-group $ECS_SG \
    --region $REGION

# Redis Security Group
REDIS_SG=$(aws ec2 create-security-group \
    --group-name "$PROJECT-redis" \
    --description "ElastiCache Redis" \
    --vpc-id $VPC_ID \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$PROJECT-redis}]" \
    --query 'GroupId' \
    --output text \
    --region $REGION)
echo "  Redis SG: $REDIS_SG"

# Allow Redis from ECS
aws ec2 authorize-security-group-ingress \
    --group-id $REDIS_SG \
    --protocol tcp \
    --port 6379 \
    --source-group $ECS_SG \
    --region $REGION
echo ""

# Create DB Subnet Group
echo "3️⃣  Creating RDS subnet group..."
aws rds create-db-subnet-group \
    --db-subnet-group-name "$PROJECT-db-subnet" \
    --db-subnet-group-description "Subnet group for $PROJECT RDS" \
    --subnet-ids $SUBNET_1 $SUBNET_2 \
    --tags Key=Name,Value=$PROJECT-db-subnet \
    --region $REGION
echo "  DB Subnet Group: $PROJECT-db-subnet"
echo ""

# Create RDS PostgreSQL (db.t4g.micro - free tier eligible)
echo "4️⃣  Creating RDS PostgreSQL..."
echo "  ⚠️  This takes 5-10 minutes..."

# Generate random password
DB_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)

aws rds create-db-instance \
    --db-instance-identifier $PROJECT \
    --db-instance-class db.t4g.micro \
    --engine postgres \
    --engine-version 16.1 \
    --master-username foxtrot \
    --master-user-password "$DB_PASSWORD" \
    --allocated-storage 20 \
    --db-subnet-group-name "$PROJECT-db-subnet" \
    --vpc-security-group-ids $RDS_SG \
    --no-publicly-accessible \
    --backup-retention-period 1 \
    --storage-type gp3 \
    --tags Key=Name,Value=$PROJECT-rds \
    --region $REGION > /dev/null

echo "  RDS instance '$PROJECT' creating..."
echo "  Username: foxtrot"
echo "  Password: (stored in AWS Secrets Manager)"
echo ""

# Store database password in Secrets Manager
echo "5️⃣  Storing secrets..."
aws secretsmanager create-secret \
    --name "$PROJECT/database" \
    --description "RDS PostgreSQL password for testing" \
    --secret-string "{\"username\":\"foxtrot\",\"password\":\"$DB_PASSWORD\",\"engine\":\"postgres\",\"host\":\"pending\",\"port\":5432,\"dbname\":\"lightengine\"}" \
    --region $REGION > /dev/null
echo "  Database secret: $PROJECT/database"

# Generate JWT secret
JWT_SECRET=$(openssl rand -base64 64 | tr -d "=+/" | cut -c1-64)
aws secretsmanager create-secret \
    --name "$PROJECT/jwt-secret" \
    --description "JWT signing secret for testing" \
    --secret-string "$JWT_SECRET" \
    --region $REGION > /dev/null
echo "  JWT secret: $PROJECT/jwt-secret"
echo ""

# Create ElastiCache subnet group
echo "6️⃣  Creating ElastiCache Redis..."
aws elasticache create-cache-subnet-group \
    --cache-subnet-group-name "$PROJECT-redis-subnet" \
    --cache-subnet-group-description "Redis subnet group" \
    --subnet-ids $SUBNET_1 $SUBNET_2 \
    --region $REGION > /dev/null

# Create Redis cluster (cache.t4g.micro - free tier eligible)
aws elasticache create-cache-cluster \
    --cache-cluster-id $PROJECT \
    --cache-node-type cache.t4g.micro \
    --engine redis \
    --engine-version 7.0 \
    --num-cache-nodes 1 \
    --cache-subnet-group-name "$PROJECT-redis-subnet" \
    --security-group-ids $REDIS_SG \
    --region $REGION > /dev/null
echo "  Redis cluster '$PROJECT' creating..."
echo ""

# Create ECR repository
echo "7️⃣  Creating ECR repository..."
aws ecr create-repository \
    --repository-name $PROJECT \
    --region $REGION > /dev/null
echo "  ECR: $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$PROJECT"
echo ""

# Wait for RDS to be available
echo "⏳ Waiting for RDS to become available..."
aws rds wait db-instance-available \
    --db-instance-identifier $PROJECT \
    --region $REGION

# Get RDS endpoint
RDS_ENDPOINT=$(aws rds describe-db-instances \
    --db-instance-identifier $PROJECT \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text \
    --region $REGION)
echo "  ✓ RDS available: $RDS_ENDPOINT"

# Update secret with RDS endpoint
aws secretsmanager update-secret \
    --secret-id "$PROJECT/database" \
    --secret-string "{\"username\":\"foxtrot\",\"password\":\"$DB_PASSWORD\",\"engine\":\"postgres\",\"host\":\"$RDS_ENDPOINT\",\"port\":5432,\"dbname\":\"lightengine\"}" \
    --region $REGION > /dev/null
echo ""

# Wait for Redis to be available
echo "⏳ Waiting for Redis to become available..."
aws elasticache wait cache-cluster-available \
    --cache-cluster-id $PROJECT \
    --region $REGION

# Get Redis endpoint
REDIS_ENDPOINT=$(aws elasticache describe-cache-clusters \
    --cache-cluster-id $PROJECT \
    --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' \
    --output text \
    --region $REGION)
echo "  ✓ Redis available: $REDIS_ENDPOINT"
echo ""

# Save configuration
CONFIG_FILE="aws-testing/config.env"
cat > $CONFIG_FILE <<EOF
# AWS Testing Environment Configuration
# Generated: $(date)

AWS_REGION=$REGION
AWS_ACCOUNT_ID=$ACCOUNT_ID

# VPC
VPC_ID=$VPC_ID
SUBNET_1=$SUBNET_1
SUBNET_2=$SUBNET_2
ECS_SG=$ECS_SG
RDS_SG=$RDS_SG
REDIS_SG=$REDIS_SG

# RDS
RDS_ENDPOINT=$RDS_ENDPOINT
RDS_DB_NAME=lightengine
RDS_USERNAME=foxtrot
# Password stored in: $PROJECT/database secret

# Redis
REDIS_ENDPOINT=$REDIS_ENDPOINT

# ECR
ECR_REPOSITORY=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$PROJECT

# Secrets Manager
SECRET_DB_ARN=arn:aws:secretsmanager:$REGION:$ACCOUNT_ID:secret:$PROJECT/database
SECRET_JWT_ARN=arn:aws:secretsmanager:$REGION:$ACCOUNT_ID:secret:$PROJECT/jwt-secret
EOF

echo "=========================================="
echo "✅ AWS Testing Infrastructure Ready!"
echo "=========================================="
echo ""
echo "Configuration saved to: $CONFIG_FILE"
echo ""
echo "Next steps:"
echo "  1. Run: source $CONFIG_FILE"
echo "  2. Run: ./aws-testing/migrate-database.sh"
echo "  3. Run: ./aws-testing/deploy-ecs.sh"
echo ""
echo "Monthly cost estimate: \$32-59 (with free tier)"
echo "=========================================="
