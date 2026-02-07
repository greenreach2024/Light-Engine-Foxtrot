#!/bin/bash
set -euo pipefail

source aws-testing/config.env

BUILDSPEC='version: 0.2
phases:
  pre_build:
    commands:
      - echo "Logging in to ECR..."
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
      - REPOSITORY_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME
  build:
    commands:
      - echo "Building Docker image..."
      - docker build -t $REPOSITORY_URI:latest -f aws-testing/Dockerfile.testing .
  post_build:
    commands:
      - echo "Pushing to ECR..."
      - docker push $REPOSITORY_URI:latest'

echo "Starting CodeBuild..."
BUILD_ID=$(aws codebuild start-build \
  --project-name foxtrot-test-build \
  --source-location-override "foxtrot-test-builds-${AWS_ACCOUNT_ID}/foxtrot-source-20260206-205004.zip" \
  --source-type-override S3 \
  --buildspec-override "$BUILDSPEC" \
  --environment-variables-override \
    name=AWS_DEFAULT_REGION,value=$AWS_REGION \
    name=AWS_ACCOUNT_ID,value=$AWS_ACCOUNT_ID \
    name=IMAGE_REPO_NAME,value=foxtrot-test \
  --region $AWS_REGION \
  --query 'build.id' \
  --output text)

echo "Build ID: $BUILD_ID"
echo "Monitoring build... (Ctrl+C to stop watching)"

while true; do
  STATUS=$(aws codebuild batch-get-builds --ids $BUILD_ID --region $AWS_REGION --query 'builds[0].buildStatus' --output text)
  PHASE=$(aws codebuild batch-get-builds --ids $BUILD_ID --region $AWS_REGION --query 'builds[0].currentPhase' --output text)
  
  echo "[$(date +%H:%M:%S)] Status: $STATUS | Phase: $PHASE"
  
  if [[ "$STATUS" == "SUCCEEDED" ]]; then
    echo "✅ Build completed successfully!"
    exit 0
  elif [[ "$STATUS" == "FAILED" ]] || [[ "$STATUS" == "FAULT" ]] || [[ "$STATUS" == "STOPPED" ]] || [[ "$STATUS" == "TIMED_OUT" ]]; then
    echo "❌ Build failed: $STATUS"
    exit 1
  fi
  
  sleep 15
done
