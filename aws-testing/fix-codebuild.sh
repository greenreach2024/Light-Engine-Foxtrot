#!/bin/bash
set -euo pipefail

AWS_REGION="us-east-1"
PROJECT_NAME="foxtrot-test-build"

echo "Fixing CodeBuild project: $PROJECT_NAME"
echo ""

# Get current project config
echo "Step 1: Fetching current project configuration..."
aws codebuild batch-get-projects \
  --names $PROJECT_NAME \
  --region $AWS_REGION \
  --output json > /tmp/codebuild-current.json

# Update project with environment variables
echo "Step 2: Updating project with environment variables..."
aws codebuild update-project \
  --name $PROJECT_NAME \
  --environment '{
    "type": "LINUX_CONTAINER",
    "image": "aws/codebuild/standard:5.0",
    "computeType": "BUILD_GENERAL1_SMALL",
    "privilegedMode": true,
    "environmentVariables": [
      {"name": "AWS_DEFAULT_REGION", "value": "us-east-1", "type": "PLAINTEXT"},
      {"name": "AWS_ACCOUNT_ID", "value": "634419072974", "type": "PLAINTEXT"},
      {"name": "IMAGE_REPO_NAME", "value": "foxtrot-test", "type": "PLAINTEXT"}
    ]
  }' \
  --region $AWS_REGION \
  --output json > /tmp/codebuild-updated.json

echo ""
echo "✅ CodeBuild project updated successfully"
echo ""

# Start a new build
echo "Step 3: Starting new build..."
BUILD_ID=$(aws codebuild start-build \
  --project-name $PROJECT_NAME \
  --region $AWS_REGION \
  --query 'build.id' \
  --output text)

echo "Build started: $BUILD_ID"
echo ""

# Monitor build
echo "Step 4: Monitoring build progress..."
for i in {1..30}; do
  sleep 15
  
  STATUS=$(aws codebuild batch-get-builds \
    --ids "$BUILD_ID" \
    --region $AWS_REGION \
    --query 'builds[0].buildStatus' \
    --output text 2>/dev/null || echo "CHECKING")
  
  PHASE=$(aws codebuild batch-get-builds \
    --ids "$BUILD_ID" \
    --region $AWS_REGION \
    --query 'builds[0].currentPhase' \
    --output text 2>/dev/null || echo "N/A")
  
  echo "[$i/30] Status: $STATUS | Phase: $PHASE"
  
  if [ "$STATUS" = "SUCCEEDED" ]; then
    echo ""
    echo "✅ Build completed successfully!"
    echo "Build ID: $BUILD_ID"
    exit 0
  elif [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "FAULT" ] || [ "$STATUS" = "STOPPED" ] || [ "$STATUS" = "TIMED_OUT" ]; then
    echo ""
    echo "❌ Build failed with status: $STATUS"
    echo "Build ID: $BUILD_ID"
    echo ""
    echo "Fetching error logs..."
    aws codebuild batch-get-builds \
      --ids "$BUILD_ID" \
      --region $AWS_REGION \
      --query 'builds[0].phases[*].[phaseType,phaseStatus]' \
      --output text
    exit 1
  fi
done

echo ""
echo "⏰ Build still in progress after 7.5 minutes"
echo "Build ID: $BUILD_ID"
echo "Continue monitoring in AWS Console"
