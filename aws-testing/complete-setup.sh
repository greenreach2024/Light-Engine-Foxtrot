#!/bin/bash
# Complete AWS Testing Setup - Manual approach
# Creates RDS, Redis, ECR using existing VPC/SGs

set -euo pipefail

echo "=========================================="
echo "Completing AWS Testing Infrastructure"
echo "=========================================="
echo ""

# Use existing resources
VPC_ID="vpc-09e79a83d43e4a8ba"
ECS_SG="sg-083ef720f7145f7fc"
RDS_SG="sg-090de4da2082a6862"
REDIS_SG="sg-05262005f2cc3f59b"
SUBNET_1="subnet-0720224b54f17bb69"
SUBNET_2="subnet-0b41b022996ced313"
REGION="us-east-1"
ACCOUNT_ID="634419072974"

echo "Using existing infrastructure:"
echo "  VPC: $VPC_ID"
echo "  ECS SG: $ECS_SG"
echo "  RDS SG: $RDS_SG"
echo "  Redis SG: $REDIS_SG"
echo ""

# Generate passwords
DB_PASSWORD="FoxtrotTest2026$(openssl rand -hex 8)"
JWT_SECRET=$(openssl rand -base64 64 | tr -d "=+/" | cut -c1-64)

echo "1️⃣  Creating RDS PostgreSQL 16.6..."
aws rds create-db-instance \
  --db-instance-identifier foxtrot-test \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16.6 \
  --master-username foxtrot \
  --master-user-password "$DB_PASSWORD" \
  --allocated-storage 20 \
  --db-subnet-group-name foxtrot-test-db-subnet \
  --vpc-security-group-ids $RDS_SG \
  --no-publicly-accessible \
  --backup-retention-period 1 \
  --storage-type gp3 \
  --region $REGION > /dev/null

echo "  ✓ RDS creating (5-10 minutes)..."
echo ""

echo "2️⃣  Creating ElastiCache Redis..."
aws elasticache create-cache-cluster \
  --cache-cluster-id foxtrot-test \
  --cache-node-type cache.t4g.micro \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-nodes 1 \
  --cache-subnet-group-name foxtrot-test-redis-subnet \
  --security-group-ids $REDIS_SG \
  --region $REGION > /dev/null 2>&1 || echo "  Subnet group missing, creating..."

# Create Redis subnet group if needed
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name foxtrot-test-redis-subnet \
  --cache-subnet-group-description "Redis subnet group" \
  --subnet-ids $SUBNET_1 $SUBNET_2 \
  --region $REGION > /dev/null 2>&1 || echo "  Redis subnet group exists"

aws elasticache create-cache-cluster \
  --cache-cluster-id foxtrot-test \
  --cache-node-type cache.t4g.micro \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-nodes 1 \
  --cache-subnet-group-name foxtrot-test-redis-subnet \
  --security-group-ids $REDIS_SG \
  --region $REGION > /dev/null

echo "  ✓ Redis creating (3-5 minutes)..."
echo ""

echo "3️⃣  Creating ECR repository..."
aws ecr create-repository \
  --repository-name foxtrot-test \
  --region $REGION > /dev/null 2>&1 || echo "  ECR repository exists"
echo "  ✓ ECR: $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/foxtrot-test"
echo ""

echo "4️⃣  Storing secrets..."
aws secretsmanager create-secret \
  --name "foxtrot-test/database" \
  --description "RDS PostgreSQL credentials" \
  --secret-string "{\"username\":\"foxtrot\",\"password\":\"$DB_PASSWORD\",\"engine\":\"postgres\",\"host\":\"pending\",\"port\":5432,\"dbname\":\"lightengine\"}" \
  --region $REGION > /dev/null

aws secretsmanager create-secret \
  --name "foxtrot-test/jwt-secret" \
  --description "JWT signing secret" \
  --secret-string "$JWT_SECRET" \
  --region $REGION > /dev/null

echo "  ✓ Secrets stored in Secrets Manager"
echo ""

echo "5️⃣  Waiting for RDS to become available..."
aws rds wait db-instance-available \
  --db-instance-identifier foxtrot-test \
  --region $REGION

RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier foxtrot-test \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text \
  --region $REGION)

echo "  ✓ RDS available: $RDS_ENDPOINT"
echo ""

# Update secret with RDS endpoint
aws secretsmanager update-secret \
  --secret-id "foxtrot-test/database" \
  --secret-string "{\"username\":\"foxtrot\",\"password\":\"$DB_PASSWORD\",\"engine\":\"postgres\",\"host\":\"$RDS_ENDPOINT\",\"port\":5432,\"dbname\":\"lightengine\"}" \
  --region $REGION > /dev/null

echo "6️⃣  Waiting for Redis to become available..."
aws elasticache wait cache-cluster-available \
  --cache-cluster-id foxtrot-test \
  --region $REGION

REDIS_ENDPOINT=$(aws elasticache describe-cache-clusters \
  --cache-cluster-id foxtrot-test \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' \
  --output text \
  --region $REGION)

echo "  ✓ Redis available: $REDIS_ENDPOINT"
echo ""

# Save configuration
mkdir -p aws-testing
cat > aws-testing/config.env <<EOF
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

# Redis
REDIS_ENDPOINT=$REDIS_ENDPOINT

# ECR
ECR_REPOSITORY=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/foxtrot-test

# Secrets Manager
SECRET_DB_ARN=arn:aws:secretsmanager:$REGION:$ACCOUNT_ID:secret:foxtrot-test/database
SECRET_JWT_ARN=arn:aws:secretsmanager:$REGION:$ACCOUNT_ID:secret:foxtrot-test/jwt-secret
EOF

echo "=========================================="
echo "✅ AWS Infrastructure Complete!"
echo "=========================================="
echo ""
echo "Configuration saved to: aws-testing/config.env"
echo ""
echo "Next steps:"
echo "  1. source aws-testing/config.env"
echo "  2. ./aws-testing/migrate-database.sh"
echo "  3. ./aws-testing/deploy-ecs.sh"
echo ""
echo "Monthly cost: ~\$32-59 (with free tier)"
echo "=========================================="
