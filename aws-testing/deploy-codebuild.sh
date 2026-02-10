#!/bin/bash
# Deploy using AWS CodeBuild (no local Docker needed)

set -euo pipefail

echo "=========================================="
echo "ECS Deployment via CodeBuild"
echo "=========================================="
echo ""

# Load configuration
if [[ ! -f "aws-testing/config.env" ]]; then
    echo "❌ Configuration not found. Run complete-setup.sh first."
    exit 1
fi

source aws-testing/config.env

# Create CodeBuild project if it doesn't exist
echo "1️⃣  Setting up CodeBuild project..."
BUILD_PROJECT="foxtrot-test-build"

# Buildspec content
BUILDSPEC_CONTENT='version: 0.2
phases:
  pre_build:
    commands:
      - echo "Logging in to Amazon ECR..."
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
      - REPOSITORY_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME
  build:
    commands:
      - echo "Building Docker image..."
      - docker build -t $REPOSITORY_URI:latest -f aws-testing/Dockerfile.testing .
  post_build:
    commands:
      - echo "Pushing Docker image..."
      - docker push $REPOSITORY_URI:latest'

# Check if project exists
if ! aws codebuild batch-get-projects --names $BUILD_PROJECT --region $AWS_REGION --query 'projects[0].name' --output text 2>/dev/null | grep -q $BUILD_PROJECT; then
    echo "  Creating CodeBuild project..."
    
    # Create service role for CodeBuild
    ROLE_NAME="foxtrot-codebuild-role"
    
    if ! aws iam get-role --role-name $ROLE_NAME 2>/dev/null >/dev/null; then
        echo "  Creating IAM role..."
        aws iam create-role \
            --role-name $ROLE_NAME \
            --assume-role-policy-document '{
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Principal": {"Service": "codebuild.amazonaws.com"},
                    "Action": "sts:AssumeRole"
                }]
            }' >/dev/null
        
        # Attach policies
        aws iam attach-role-policy \
            --role-name $ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser >/dev/null
        
        aws iam attach-role-policy \
            --role-name $ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess >/dev/null
        
        sleep 10  # Wait for role propagation
    fi
    
    ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)
    
    # Create temp bucket for source
    BUCKET_NAME="foxtrot-test-builds-${AWS_ACCOUNT_ID}"
    if ! aws s3 ls "s3://${BUCKET_NAME}" 2>/dev/null; then
        aws s3 mb "s3://${BUCKET_NAME}" --region $AWS_REGION >/dev/null
    fi
    
    # Create CodeBuild project with S3 source
    aws codebuild create-project \
        --name $BUILD_PROJECT \
        --source type=S3,location="${BUCKET_NAME}/source.zip" \
        --artifacts type=NO_ARTIFACTS \
        --environment type=LINUX_CONTAINER,image=aws/codebuild/standard:7.0,computeType=BUILD_GENERAL1_SMALL,privilegedMode=true \
        --service-role $ROLE_ARN \
        --region $AWS_REGION >/dev/null
    
    echo "  ✓ CodeBuild project created"
else
    echo "  ✓ CodeBuild project exists"
fi

# Upload source code to S3
echo ""
echo "2️⃣  Uploading source code..."
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SOURCE_BUNDLE="foxtrot-source-${TIMESTAMP}.zip"

# Create source bundle (only include necessary files)
echo "  Creating source bundle..."
cd /Users/petergilbert/Light-Engine-Foxtrot

# Create a temporary directory with only what we need
TEMP_DIR="/tmp/foxtrot-build-${TIMESTAMP}"
mkdir -p $TEMP_DIR

# Copy only essential files
cp -r lib $TEMP_DIR/ 2>/dev/null || true
cp -r public $TEMP_DIR/ 2>/dev/null || true
cp -r services $TEMP_DIR/
if [ ! -d "$TEMP_DIR/services" ]; then
    echo "❌ Failed to copy services directory!"
    exit 1
fi
echo "  Services directory contents:"
ls $TEMP_DIR/services | head -n 5
cp -r scripts $TEMP_DIR/ 2>/dev/null || true
cp -r backend $TEMP_DIR/ 2>/dev/null || true
cp -r server $TEMP_DIR/
# Verify server directory
if [ ! -d "$TEMP_DIR/server" ]; then
    echo "❌ Failed to copy server directory!"
    exit 1
fi
echo "  Server directory contents:"
ls $TEMP_DIR/server/middleware
cp -r src $TEMP_DIR/ 2>/dev/null || true
cp -r aws-testing $TEMP_DIR/
cp package*.json $TEMP_DIR/
cp requirements*.txt $TEMP_DIR/ 2>/dev/null || true
cp server*.js $TEMP_DIR/ 2>/dev/null || true
cp ecosystem.config.cjs $TEMP_DIR/ 2>/dev/null || true
cp *.md $TEMP_DIR/ 2>/dev/null || true

# Create zip from temp directory
cd $TEMP_DIR
zip -r /tmp/$SOURCE_BUNDLE . >/dev/null 2>&1
cd -
rm -rf $TEMP_DIR

BUNDLE_SIZE=$(du -h /tmp/$SOURCE_BUNDLE | cut -f1)
echo "  ✓ Source bundle created: $BUNDLE_SIZE"

# Create S3 bucket if needed
BUCKET_NAME="foxtrot-test-builds-${AWS_ACCOUNT_ID}"
if ! aws s3 ls "s3://${BUCKET_NAME}" 2>/dev/null; then
    echo "  Creating S3 bucket..."
    aws s3 mb "s3://${BUCKET_NAME}" --region $AWS_REGION
fi

# Upload source
aws s3 cp /tmp/$SOURCE_BUNDLE "s3://${BUCKET_NAME}/${SOURCE_BUNDLE}"
echo "  ✓ Source uploaded: s3://${BUCKET_NAME}/${SOURCE_BUNDLE}"

# Start build
echo ""
echo "3️⃣  Starting CodeBfile://uild (3-5 minutes)..."
BUILD_ID=$(aws codebuild start-build \
    --project-name $BUILD_PROJECT \
    --source-location-override "${BUCKET_NAME}/${SOURCE_BUNDLE}" \
    --source-type-override S3 \
    --buildspec-override "$BUILDSPEC_CONTENT" \
    --environment-variables-override \
        name=AWS_DEFAULT_REGION,value=$AWS_REGION \
        name=AWS_ACCOUNT_ID,value=$AWS_ACCOUNT_ID \
        name=IMAGE_REPO_NAME,value=foxtrot-test \
    --region $AWS_REGION \
    --query 'build.id' \
    --output text)

echo "  Build ID: $BUILD_ID"
echo "  Logs: https://console.aws.amazon.com/codesuite/codebuild/projects/$BUILD_PROJECT/build/$BUILD_ID"

# Wait for build to complete
echo "  Waiting for build..."
while true; do
  BUILD_STATUS=$(aws codebuild batch-get-builds --ids $BUILD_ID --region $AWS_REGION --query 'builds[0].buildStatus' --output text)
  if [[ "$BUILD_STATUS" == "SUCCEEDED" || "$BUILD_STATUS" == "FAILED" || "$BUILD_STATUS" == "STOPPED" || "$BUILD_STATUS" == "FAULT" || "$BUILD_STATUS" == "TIMED_OUT" ]]; then
    break
  fi
  echo -n "."
  sleep 10
done
echo ""

if [[ "$BUILD_STATUS" != "SUCCEEDED" ]]; then
    echo "❌ Build failed: $BUILD_STATUS"
    echo "Check logs at: https://console.aws.amazon.com/codesuite/codebuild/projects/$BUILD_PROJECT/build/$BUILD_ID"
    exit 1
fi

echo "  ✓ Build completed successfully"

# Continue with ECS deployment (same as deploy-ecs.sh from step 4 onwards)
echo ""
echo "4️⃣  Creating ECS cluster..."
if ! aws ecs describe-clusters --clusters foxtrot-test --region $AWS_REGION --query 'clusters[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
    aws ecs create-cluster --cluster-name foxtrot-test --region $AWS_REGION >/dev/null
    echo "  ✓ Cluster created"
else
    echo "  ✓ Cluster exists"
fi

# Create IAM roles for ECS
echo ""
echo "5️⃣  Creating IAM roles..."

# Task execution role
EXEC_ROLE_NAME="foxtrot-test-execution-role"
if ! aws iam get-role --role-name $EXEC_ROLE_NAME 2>/dev/null >/dev/null; then
    aws iam create-role \
        --role-name $EXEC_ROLE_NAME \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "ecs-tasks.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }' >/dev/null
    
    aws iam attach-role-policy \
        --role-name $EXEC_ROLE_NAME \
        --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null
    
    # Add Secrets Manager permissions
    aws iam put-role-policy \
        --role-name $EXEC_ROLE_NAME \
        --policy-name SecretsManagerAccess \
        --policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Action": [
                    "secretsmanager:GetSecretValue",
                    "kms:Decrypt"
                ],
                "Resource": "*"
            }]
        }' >/dev/null
fi
EXEC_ROLE_ARN=$(aws iam get-role --role-name $EXEC_ROLE_NAME --query 'Role.Arn' --output text)

# Task role
TASK_ROLE_NAME="foxtrot-test-task-role"
if ! aws iam get-role --role-name $TASK_ROLE_NAME 2>/dev/null >/dev/null; then
    aws iam create-role \
        --role-name $TASK_ROLE_NAME \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "ecs-tasks.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }' >/dev/null
    
    # Add application permissions
    aws iam put-role-policy \
        --role-name $TASK_ROLE_NAME \
        --policy-name AppPermissions \
        --policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Action": [
                    "ses:SendEmail",
                    "ses:SendRawEmail",
                    "s3:GetObject",
                    "s3:PutObject"
                ],
                "Resource": "*"
            }]
        }' >/dev/null
fi
TASK_ROLE_ARN=$(aws iam get-role --role-name $TASK_ROLE_NAME --query 'Role.Arn' --output text)

echo "  ✓ Roles configured"

# Register task definition
echo ""
echo "6️⃣  Registering ECS task definition..."

ECR_REPOSITORY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/foxtrot-test"

TASK_DEF=$(cat <<EOF
{

  "family": "foxtrot-test",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "$EXEC_ROLE_ARN",
  "taskRoleArn": "$TASK_ROLE_ARN",
  "containerDefinitions": [{
    "name": "foxtrot-app",
    "image": "$ECR_REPOSITORY:latest",
    "portMappings": [
      {"containerPort": 8091, "protocol": "tcp"},
      {"containerPort": 8000, "protocol": "tcp"}
    ],
    "environment": [
      {"name": "PORT", "value": "8091"},
      {"name": "PYTHON_PORT", "value": "8000"},
      {"name": "NODE_ENV", "value": "production"},
      {"name": "DATABASE_TYPE", "value": "postgres"},
      {"name": "DB_HOST", "value": "$RDS_ENDPOINT"},
      {"name": "DB_NAME", "value": "lightengine"},
      {"name": "DB_USER", "value": "foxtrot"},
      {"name": "REDIS_HOST", "value": "${REDIS_ENDPOINT%:*}"},
      {"name": "REDIS_PORT", "value": "${REDIS_ENDPOINT##*:}"}
    ],
    "secrets": [
      {
        "name": "DB_PASSWORD",
        "valueFrom": "$SECRET_DB_ARN:password::"
      },
      {
        "name": "JWT_SECRET",
        "valueFrom": "$SECRET_JWT_ARN"
      }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/foxtrot-test",
        "awslogs-region": "$AWS_REGION",
        "awslogs-stream-prefix": "ecs",
        "awslogs-create-group": "true"
      }
    },
    "healthCheck": {
      "command": ["CMD-SHELL", "curl -f http://localhost:8091/health || exit 1"],
      "interval": 30,
      "timeout": 5,
      "retries": 3,
      "startPeriod": 60
    }
  }]
}
EOF
)

TASK_DEF_ARN=$(echo "$TASK_DEF" | aws ecs register-task-definition \
    --cli-input-json file:///dev/stdin \
    --region $AWS_REGION \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

echo "  ✓ Task definition registered"

# Create or update service
echo ""
echo "7️⃣  Deploying ECS service..."

if aws ecs describe-services --cluster foxtrot-test --services foxtrot --region $AWS_REGION --query 'services[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
    echo "  Updating existing service..."
    aws ecs update-service \
        --cluster foxtrot-test \
        --service foxtrot \
        --task-definition $TASK_DEF_ARN \
        --force-new-deployment \
        --region $AWS_REGION >/dev/null
else
    echo "  Creating new service..."
    aws ecs create-service \
        --cluster foxtrot-test \
        --service-name foxtrot \
        --task-definition $TASK_DEF_ARN \
        --desired-count 1 \
        --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_1,$SUBNET_2],securityGroups=[$ECS_SG],assignPublicIp=ENABLED}" \
        --region $AWS_REGION >/dev/null
fi

echo "  ✓ Service deployed"

# Wait for service to stabilize
echo ""
echo "8️⃣  Waiting for service to stabilize (2-3 minutes)..."
aws ecs wait services-stable \
    --cluster foxtrot-test \
    --services foxtrot \
    --region $AWS_REGION

# Get public IP
echo ""
echo "9️⃣  Retrieving public IP..."
TASK_ARN=$(aws ecs list-tasks \
    --cluster foxtrot-test \
    --service-name foxtrot \
    --region $AWS_REGION \
    --query 'taskArns[0]' \
    --output text)

ENI_ID=$(aws ecs describe-tasks \
    --cluster foxtrot-test \
    --tasks $TASK_ARN \
    --region $AWS_REGION \
    --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' \
    --output text)

PUBLIC_IP=$(aws ec2 describe-network-interfaces \
    --network-interface-ids $ENI_ID \
    --region $AWS_REGION \
    --query 'NetworkInterfaces[0].Association.PublicIp' \
    --output text)

echo ""
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
echo "Dashboards:"
echo "  http://$PUBLIC_IP:8091/farm-admin-login.html"
echo "  http://$PUBLIC_IP:8091/views/nutrient-management.html"
echo "  http://$PUBLIC_IP:8091/farm-vitality.html"
echo ""
echo "CloudWatch Logs:"
echo "  https://console.aws.amazon.com/cloudwatch/home?region=$AWS_REGION#logsV2:log-groups/log-group//ecs/foxtrot-test"
echo ""
