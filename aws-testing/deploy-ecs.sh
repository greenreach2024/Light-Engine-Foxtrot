#!/bin/bash
# ECS Fargate Deployment Script
# Deploys single task with combined Node.js + Python container

set -euo pipefail

echo "=========================================="
echo "ECS Fargate Deployment"
echo "=========================================="
echo ""

# Load configuration
if [[ ! -f "aws-testing/config.env" ]]; then
    echo "❌ Configuration not found. Run setup-infrastructure.sh first."
    exit 1
fi

source aws-testing/config.env

echo "1️⃣  Building Docker image..."
docker build -f aws-testing/Dockerfile.testing -t foxtrot-test:latest .
echo "  ✓ Image built"
echo ""

echo "2️⃣  Pushing to ECR..."
# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_REPOSITORY

# Tag and push
docker tag foxtrot-test:latest $ECR_REPOSITORY:latest
docker push $ECR_REPOSITORY:latest
echo "  ✓ Image pushed: $ECR_REPOSITORY:latest"
echo ""

# Create ECS cluster if needed
echo "3️⃣  Creating ECS cluster..."
aws ecs create-cluster \
    --cluster-name foxtrot-test \
    --region $AWS_REGION > /dev/null 2>&1 || echo "  Cluster already exists"
echo "  ✓ Cluster ready: foxtrot-test"
echo ""

# Create IAM roles
echo "4️⃣  Creating IAM roles..."

# ECS Task Execution Role (for ECS to pull image, write logs)
EXECUTION_ROLE_NAME="foxtrotTestEcsExecutionRole"
aws iam create-role \
    --role-name $EXECUTION_ROLE_NAME \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "ecs-tasks.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    }' \
    --region $AWS_REGION > /dev/null 2>&1 || echo "  Execution role exists"

aws iam attach-role-policy \
    --role-name $EXECUTION_ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy \
    --region $AWS_REGION 2>/dev/null || true

# Attach Secrets Manager read policy
aws iam attach-role-policy \
    --role-name $EXECUTION_ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite \
    --region $AWS_REGION 2>/dev/null || true

# ECS Task Role (for application code to access AWS services)
TASK_ROLE_NAME="foxtrotTestEcsTaskRole"
aws iam create-role \
    --role-name $TASK_ROLE_NAME \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "ecs-tasks.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    }' \
    --region $AWS_REGION > /dev/null 2>&1 || echo "  Task role exists"

# Attach policies for task to access services
aws iam attach-role-policy \
    --role-name $TASK_ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess \
    --region $AWS_REGION 2>/dev/null || true

aws iam attach-role-policy \
    --role-name $TASK_ROLE_NAME \
    --policy-arn arn:aws:iam::aws:policy/AmazonSESFullAccess \
    --region $AWS_REGION 2>/dev/null || true

EXECUTION_ROLE_ARN="arn:aws:iam::$AWS_ACCOUNT_ID:role/$EXECUTION_ROLE_NAME"
TASK_ROLE_ARN="arn:aws:iam::$AWS_ACCOUNT_ID:role/$TASK_ROLE_NAME"

echo "  ✓ Execution role: $EXECUTION_ROLE_ARN"
echo "  ✓ Task role: $TASK_ROLE_ARN"
echo ""

# Create CloudWatch log group
echo "5️⃣  Creating CloudWatch log group..."
aws logs create-log-group \
    --log-group-name /ecs/foxtrot-test \
    --region $AWS_REGION 2>/dev/null || echo "  Log group exists"
echo "  ✓ Log group: /ecs/foxtrot-test"
echo ""

# Get database connection string from Secrets Manager
DB_SECRET_ARN="arn:aws:secretsmanager:$AWS_REGION:$AWS_ACCOUNT_ID:secret:foxtrot-test/database"
JWT_SECRET_ARN="arn:aws:secretsmanager:$AWS_REGION:$AWS_ACCOUNT_ID:secret:foxtrot-test/jwt-secret"

# Register task definition
echo "6️⃣  Registering ECS task definition..."
TASK_DEF=$(cat <<EOF
{
  "family": "foxtrot-test",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "$EXECUTION_ROLE_ARN",
  "taskRoleArn": "$TASK_ROLE_ARN",
  "containerDefinitions": [
    {
      "name": "foxtrot",
      "image": "$ECR_REPOSITORY:latest",
      "portMappings": [
        {"containerPort": 8091, "protocol": "tcp"},
        {"containerPort": 8000, "protocol": "tcp"}
      ],
      "essential": true,
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "8091"},
        {"name": "PYTHON_PORT", "value": "8000"},
        {"name": "DB_ENABLED", "value": "true"},
        {"name": "DB_HOST", "value": "$DB_ENDPOINT"},
        {"name": "DB_NAME", "value": "lightengine"},
        {"name": "DB_PORT", "value": "5432"},
        {"name": "REDIS_HOST", "value": "$REDIS_HOST"},
        {"name": "REDIS_PORT", "value": "6379"},
        {"name": "AWS_REGION", "value": "$AWS_REGION"},
        {"name": "FARM_ID", "value": "FARM-TEST-WIZARD-001"},
        {"name": "EDGE_MODE", "value": "true"},
        {"name": "GREENREACH_CENTRAL_URL", "value": "http://www.greenreachgreens.com"}
      ],
      "secrets": [
        {
          "name": "JWT_SECRET",
          "valueFrom": "$JWT_SECRET_ARN"
        },
        {
          "name": "DB_USER",
          "valueFrom": "$DB_SECRET_ARN:username::"
        },
        {
          "name": "DB_PASSWORD",
          "valueFrom": "$DB_SECRET_ARN:password::"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/foxtrot-test",
          "awslogs-region": "$AWS_REGION",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8091/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
EOF
)

echo "$TASK_DEF" | aws ecs register-task-definition \
    --cli-input-json file:///dev/stdin \
    --region $AWS_REGION > /dev/null

echo "  ✓ Task definition registered: foxtrot-test"
echo ""

# Create ECS service
echo "7️⃣  Creating ECS service..."
aws ecs create-service \
    --cluster foxtrot-test \
    --service-name foxtrot \
    --task-definition foxtrot-test \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_1,$SUBNET_2],securityGroups=[$ECS_SG],assignPublicIp=ENABLED}" \
    --region $AWS_REGION > /dev/null 2>&1 || {
        echo "  Service exists, updating..."
        aws ecs update-service \
            --cluster foxtrot-test \
            --service foxtrot \
            --task-definition foxtrot-test \
            --desired-count 1 \
            --force-new-deployment \
            --region $AWS_REGION > /dev/null
    }
echo "  ✓ Service deployed: foxtrot"
echo ""

# Wait for service to stabilize
echo "⏳ Waiting for service to become stable..."
echo "  (This takes 2-3 minutes...)"
aws ecs wait services-stable \
    --cluster foxtrot-test \
    --services foxtrot \
    --region $AWS_REGION

echo "  ✓ Service stable"
echo ""

# Get task public IP
TASK_ARN=$(aws ecs list-tasks \
    --cluster foxtrot-test \
    --service-name foxtrot \
    --query 'taskArns[0]' \
    --output text \
    --region $AWS_REGION)

ENI_ID=$(aws ecs describe-tasks \
    --cluster foxtrot-test \
    --tasks $TASK_ARN \
    --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' \
    --output text \
    --region $AWS_REGION)

PUBLIC_IP=$(aws ec2 describe-network-interfaces \
    --network-interface-ids $ENI_ID \
    --query 'NetworkInterfaces[0].Association.PublicIp' \
    --output text \
    --region $AWS_REGION)

echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Service URL (Node.js): http://$PUBLIC_IP:8091"
echo "Python Backend: http://$PUBLIC_IP:8000"
echo ""
echo "Test endpoints:"
echo "  curl http://$PUBLIC_IP:8091/health"
echo "  curl http://$PUBLIC_IP:8091/api/wholesale/catalog"
echo ""
echo "View logs:"
echo "  aws logs tail /ecs/foxtrot-test --follow --region $AWS_REGION"
echo ""
echo "Monthly cost: ~\$32-59 (with free tier)"
echo "=========================================="
