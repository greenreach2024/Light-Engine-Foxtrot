#!/bin/bash

# Light Engine Charlie - AWS Lambda Deployment Script
# Usage: ./deploy.sh

set -e

echo "🚀 Light Engine Charlie - Lambda Deployment"
echo "============================================"
echo

# Check for AWS CLI
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Install with: brew install awscli"
    exit 1
fi

# Check for credentials
if [ -z "$SWITCHBOT_TOKEN" ] || [ -z "$SWITCHBOT_SECRET" ]; then
    echo "⚠️  SwitchBot credentials not set"
    echo "Please set environment variables:"
    echo "  export SWITCHBOT_TOKEN=your-token"
    echo "  export SWITCHBOT_SECRET=your-secret"
    echo
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Configuration
FUNCTION_NAME="light-engine-sensor-aggregator"
RUNTIME="nodejs20.x"
HANDLER="index.handler"
TIMEOUT=10
MEMORY=256
REGION="${AWS_REGION:-us-east-1}"

echo "📦 Installing dependencies..."
if [ -f package.json ]; then
  npm ci --omit=dev || npm install --only=prod
else
  echo "No package.json found; skipping npm install"
fi

echo "📦 Packaging function..."
zip -q -r function.zip index.mjs package.json node_modules
echo "✅ Package created: function.zip"
echo

# Check if function exists
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &> /dev/null; then
    echo "🔄 Updating existing function..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://function.zip \
        --region "$REGION"
    
    # Update environment variables if provided
    if [ -n "$SWITCHBOT_TOKEN" ] && [ -n "$SWITCHBOT_SECRET" ]; then
        echo "🔧 Updating environment variables..."
        aws lambda update-function-configuration \
            --function-name "$FUNCTION_NAME" \
            --environment "Variables={SWITCHBOT_TOKEN=$SWITCHBOT_TOKEN,SWITCHBOT_SECRET=$SWITCHBOT_SECRET}" \
            --region "$REGION" \
            > /dev/null
    fi
    
    echo "✅ Function updated successfully"
else
    echo "📝 Creating new function..."
    
    # Get or create execution role
    ROLE_NAME="light-engine-lambda-role"
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || echo "")
    
    if [ -z "$ROLE_ARN" ]; then
        echo "Creating IAM role..."
        
        # Create trust policy
        cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
        
        aws iam create-role \
            --role-name "$ROLE_NAME" \
            --assume-role-policy-document file:///tmp/trust-policy.json \
            > /dev/null
        
        aws iam attach-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
        
        ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
        
        echo "⏳ Waiting for role to be ready..."
        sleep 10
    fi
    
    # Create function
    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime "$RUNTIME" \
        --role "$ROLE_ARN" \
        --handler "$HANDLER" \
        --zip-file fileb://function.zip \
        --timeout "$TIMEOUT" \
        --memory-size "$MEMORY" \
        --region "$REGION" \
        --environment "Variables={SWITCHBOT_TOKEN=$SWITCHBOT_TOKEN,SWITCHBOT_SECRET=$SWITCHBOT_SECRET}" \
        > /dev/null
    
    echo "✅ Function created successfully"
fi

echo

# Create or update function URL
echo "🌐 Setting up Function URL..."
if aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" &> /dev/null; then
    echo "Function URL already exists"
else
    aws lambda create-function-url-config \
        --function-name "$FUNCTION_NAME" \
        --auth-type NONE \
        --cors "AllowOrigins=*,AllowMethods=GET,AllowHeaders=*" \
        --region "$REGION" \
        > /dev/null
    echo "✅ Function URL created"
fi

# Get function URL
FUNCTION_URL=$(aws lambda get-function-url-config \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --query 'FunctionUrl' \
    --output text)

echo
echo "============================================"
echo "✅ Deployment Complete!"
echo "============================================"
echo
echo "Function URL: $FUNCTION_URL"
echo
echo "Next steps:"
echo "1. Test the endpoint:"
echo "   curl $FUNCTION_URL"
echo
echo "2. Configure Light Engine Charlie:"
echo "   export ENV_SOURCE=cloud"
echo "   export AWS_ENDPOINT_URL=$FUNCTION_URL"
echo
echo "3. Start the server:"
echo "   cd .. && npm run start"
echo

# Cleanup
rm -f function.zip

echo "🎉 All done!"
