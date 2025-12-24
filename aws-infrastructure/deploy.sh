#!/bin/bash
set -e

# Light Engine Foxtrot - AWS Deployment Script
# Deploys the complete infrastructure to AWS using CloudFormation

ENVIRONMENT="${1:-production}"
STACK_NAME="${ENVIRONMENT}-light-engine-stack"
REGION="${AWS_REGION:-us-east-1}"
DOMAIN_NAME="${DOMAIN_NAME:-greenreach.io}"

echo "======================================="
echo "Light Engine Foxtrot - AWS Deployment"
echo "======================================="
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "Stack: $STACK_NAME"
echo ""

# Check prerequisites
command -v aws >/dev/null 2>&1 || { echo "Error: AWS CLI is required but not installed."; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Error: Docker is required but not installed."; exit 1; }

# Check AWS credentials
aws sts get-caller-identity >/dev/null 2>&1 || { echo "Error: AWS credentials not configured."; exit 1; }
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "AWS Account: $ACCOUNT_ID"
echo ""

# Step 1: Request SSL Certificate (if not exists)
echo "[1/8] Checking SSL certificate..."
CERT_ARN=$(aws acm list-certificates --region $REGION \
  --query "CertificateSummaryList[?DomainName=='*.${DOMAIN_NAME}'].CertificateArn" \
  --output text)

if [ -z "$CERT_ARN" ]; then
  echo "Requesting SSL certificate for *.${DOMAIN_NAME}..."
  CERT_ARN=$(aws acm request-certificate \
    --region $REGION \
    --domain-name "*.${DOMAIN_NAME}" \
    --subject-alternative-names "${DOMAIN_NAME}" \
    --validation-method DNS \
    --query CertificateArn \
    --output text)
  
  echo "Certificate ARN: $CERT_ARN"
  echo ""
  echo "IMPORTANT: You must validate the certificate via DNS before continuing."
  echo "Check AWS Certificate Manager console for validation records."
  read -p "Press Enter after adding DNS validation records..."
  
  # Wait for certificate validation
  echo "Waiting for certificate validation..."
  aws acm wait certificate-validated --region $REGION --certificate-arn $CERT_ARN
fi

echo "Certificate ARN: $CERT_ARN"
echo ""

# Step 2: Create ECR repositories
echo "[2/8] Creating ECR repositories..."
aws ecr describe-repositories --repository-names light-engine --region $REGION >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name light-engine --region $REGION

aws ecr describe-repositories --repository-names light-engine-central --region $REGION >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name light-engine-central --region $REGION

echo "ECR repositories ready"
echo ""

# Step 3: Build and push Docker images
echo "[3/8] Building and pushing Docker images..."

# Login to ECR
aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

# Build main app image
echo "Building main application..."
docker build -t light-engine:latest -f Dockerfile .
docker tag light-engine:latest ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/light-engine:latest
docker push ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/light-engine:latest

# Build central dashboard image
echo "Building central dashboard..."
docker build -t light-engine-central:latest -f greenreach-central-app/Dockerfile greenreach-central-app/
docker tag light-engine-central:latest ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/light-engine-central:latest
docker push ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/light-engine-central:latest

echo "Docker images pushed successfully"
echo ""

# Step 4: Generate database password
echo "[4/8] Generating database password..."
DB_PASSWORD=$(openssl rand -base64 32)
echo "Database password generated (will be stored in Secrets Manager)"
echo ""

# Step 5: Create admin token secret
echo "[5/8] Creating admin token secret..."
ADMIN_TOKEN=$(openssl rand -hex 32)

aws secretsmanager create-secret \
  --region $REGION \
  --name "${ENVIRONMENT}/light-engine/admin-token" \
  --secret-string "{\"token\":\"${ADMIN_TOKEN}\"}" \
  2>/dev/null || \
aws secretsmanager update-secret \
  --region $REGION \
  --secret-id "${ENVIRONMENT}/light-engine/admin-token" \
  --secret-string "{\"token\":\"${ADMIN_TOKEN}\"}"

echo "Admin token stored in Secrets Manager"
echo ""

# Step 6: Deploy CloudFormation stack
echo "[6/8] Deploying CloudFormation stack..."
aws cloudformation deploy \
  --region $REGION \
  --stack-name $STACK_NAME \
  --template-file aws-infrastructure/cloudformation-stack.yaml \
  --parameter-overrides \
    Environment=$ENVIRONMENT \
    DBPassword=$DB_PASSWORD \
    DomainName=$DOMAIN_NAME \
    CertificateArn=$CERT_ARN \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset

echo "CloudFormation stack deployed"
echo ""

# Step 7: Get stack outputs
echo "[7/8] Retrieving stack outputs..."
ALB_DNS=$(aws cloudformation describe-stacks \
  --region $REGION \
  --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDNS'].OutputValue" \
  --output text)

DB_ENDPOINT=$(aws cloudformation describe-stacks \
  --region $REGION \
  --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" \
  --output text)

echo "Load Balancer DNS: $ALB_DNS"
echo "Database Endpoint: $DB_ENDPOINT"
echo ""

# Step 8: Initialize database
echo "[8/8] Database initialization..."
echo "Run database migrations manually:"
echo ""
echo "  # Connect to database via bastion host or from ECS task"
echo "  psql postgresql://lightengine:PASSWORD@${DB_ENDPOINT}:5432/light_engine"
echo "  # Then run migrations:"
echo "  \\i greenreach-central-app/schema.sql"
echo ""

# Deployment summary
echo "======================================="
echo "Deployment Complete!"
echo "======================================="
echo ""
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo ""
echo "Load Balancer: $ALB_DNS"
echo "Admin Token: ${ADMIN_TOKEN:0:10}... (check Secrets Manager)"
echo ""
echo "Next Steps:"
echo "1. Update DNS records:"
echo "   - *.${DOMAIN_NAME} CNAME ${ALB_DNS}"
echo "   - central.${DOMAIN_NAME} CNAME ${ALB_DNS}"
echo ""
echo "2. Run database migrations (see instructions above)"
echo ""
echo "3. Access the application:"
echo "   - Main App: https://*.${DOMAIN_NAME}"
echo "   - Central Dashboard: https://central.${DOMAIN_NAME}"
echo ""
echo "4. Monitor deployment:"
echo "   - CloudWatch Logs: /ecs/${ENVIRONMENT}/light-engine/*"
echo "   - ECS Console: https://console.aws.amazon.com/ecs"
echo ""
echo "======================================="

# Save deployment info
cat > deployment-info.txt <<EOF
Light Engine Foxtrot - Deployment Information
==============================================

Environment: $ENVIRONMENT
Region: $REGION
Date: $(date)

Infrastructure:
- Stack Name: $STACK_NAME
- Load Balancer: $ALB_DNS
- Database: $DB_ENDPOINT
- Account ID: $ACCOUNT_ID

Secrets:
- Admin Token: Stored in Secrets Manager at ${ENVIRONMENT}/light-engine/admin-token
- Database Password: Stored in Secrets Manager at ${ENVIRONMENT}/light-engine/database

DNS Configuration:
- *.${DOMAIN_NAME} -> $ALB_DNS (CNAME)
- central.${DOMAIN_NAME} -> $ALB_DNS (CNAME)

Access URLs:
- Main App: https://*.${DOMAIN_NAME}
- Central Dashboard: https://central.${DOMAIN_NAME}
- Admin Token: ${ADMIN_TOKEN}

CloudWatch Logs:
- Main App: /ecs/${ENVIRONMENT}/light-engine/main
- Central: /ecs/${ENVIRONMENT}/light-engine/central

S3 Buckets:
- Data: ${ENVIRONMENT}-light-engine-data
- Backups: ${ENVIRONMENT}-light-engine-backups

EOF

echo "Deployment information saved to deployment-info.txt"
echo ""
