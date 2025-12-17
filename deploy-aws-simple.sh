#!/bin/bash
# Simple AWS S3 Static Website Deployment
# Cost: $0-2/month (free tier first 12 months)

set -e

echo "🚀 Light Engine - AWS S3 Deployment"
echo "===================================="

# Configuration
BUCKET_NAME="light-engine-demo-$(date +%s)"
REGION="us-east-1"

echo ""
echo "📋 This will:"
echo "  - Create S3 bucket: $BUCKET_NAME"
echo "  - Upload your demo files"
echo "  - Configure static website hosting"
echo "  - Make files publicly accessible"
echo ""
echo "💰 Cost: ~$0-2/month (free tier eligible)"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Check AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS CLI not configured"
    echo "Run: aws configure"
    exit 1
fi

echo ""
echo "1️⃣ Creating S3 bucket..."
aws s3 mb s3://$BUCKET_NAME --region $REGION

echo "2️⃣ Configuring bucket for static website hosting..."
aws s3 website s3://$BUCKET_NAME --index-document index.html --error-document index.html

echo "3️⃣ Setting bucket policy for public access..."
cat > /tmp/bucket-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
    }
  ]
}
EOF

aws s3api put-bucket-policy --bucket $BUCKET_NAME --policy file:///tmp/bucket-policy.json

echo "4️⃣ Disabling block public access..."
aws s3api put-public-access-block \
    --bucket $BUCKET_NAME \
    --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

echo "5️⃣ Uploading demo files from docs/ folder..."
aws s3 sync docs/ s3://$BUCKET_NAME/ \
    --delete \
    --cache-control "max-age=3600" \
    --metadata-directive REPLACE

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Your demo is live at:"
echo "   http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com"
echo ""
echo "💾 Save this URL for future reference"
echo ""
echo "📊 Monitor costs: https://console.aws.amazon.com/billing/home"
echo ""

# Save URL to file
echo "http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com" > AWS_DEMO_URL.txt
echo "✅ URL saved to AWS_DEMO_URL.txt"
