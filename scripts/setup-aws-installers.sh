#!/bin/bash
# Create AWS S3 bucket and CloudFront distribution for Light Engine installers
# Run this BEFORE building and uploading installers

set -e

# Configuration
BUCKET_NAME="${AWS_S3_BUCKET:-light-engine-installers}"
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")

if [ -z "$ACCOUNT_ID" ]; then
  echo "❌ AWS credentials not configured. Run 'aws configure' first."
  exit 1
fi

echo "🚀 Setting up AWS infrastructure for Light Engine installers"
echo "📦 Bucket: ${BUCKET_NAME}"
echo "🌎 Region: ${REGION}"
echo "👤 Account: ${ACCOUNT_ID}"
echo ""

# Step 1: Create S3 bucket
echo "📦 Step 1: Creating S3 bucket..."
if aws s3 ls "s3://${BUCKET_NAME}" &>/dev/null; then
  echo "   ✅ Bucket already exists: ${BUCKET_NAME}"
else
  aws s3 mb "s3://${BUCKET_NAME}" --region "${REGION}"
  echo "   ✅ Bucket created: ${BUCKET_NAME}"
fi

# Step 2: Enable versioning
echo "📦 Step 2: Enabling versioning..."
aws s3api put-bucket-versioning \
  --bucket "${BUCKET_NAME}" \
  --versioning-configuration Status=Enabled
echo "   ✅ Versioning enabled"

# Step 3: Block public access (CloudFront only)
echo "🔒 Step 3: Blocking public access..."
aws s3api put-public-access-block \
  --bucket "${BUCKET_NAME}" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
echo "   ✅ Public access blocked"

# Step 4: Create Origin Access Control (OAC)
echo "🔐 Step 4: Creating Origin Access Control..."
OAC_NAME="light-engine-s3-oac"
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='${OAC_NAME}'].Id" \
  --output text 2>/dev/null)

if [ -z "$OAC_ID" ] || [ "$OAC_ID" == "None" ]; then
  OAC_RESPONSE=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config \
      Name="${OAC_NAME}",\
Description="OAC for Light Engine installers",\
SigningProtocol=sigv4,\
SigningBehavior=always,\
OriginAccessControlOriginType=s3 \
    --output json)
  
  OAC_ID=$(echo "$OAC_RESPONSE" | grep -o '"Id": "[^"]*"' | head -1 | cut -d'"' -f4)
  echo "   ✅ OAC created: ${OAC_ID}"
else
  echo "   ✅ OAC already exists: ${OAC_ID}"
fi

# Step 5: Create CloudFront distribution
echo "☁️  Step 5: Creating CloudFront distribution..."
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='Light Engine Installers CDN'].Id" \
  --output text 2>/dev/null)

if [ -z "$DISTRIBUTION_ID" ] || [ "$DISTRIBUTION_ID" == "None" ]; then
  cat > /tmp/cloudfront-config.json <<EOF
{
  "CallerReference": "light-engine-$(date +%s)",
  "Comment": "Light Engine Installers CDN",
  "Enabled": true,
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-${BUCKET_NAME}",
        "DomainName": "${BUCKET_NAME}.s3.${REGION}.amazonaws.com",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        },
        "OriginAccessControlId": "${OAC_ID}"
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-${BUCKET_NAME}",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"],
      "CachedMethods": {
        "Quantity": 2,
        "Items": ["GET", "HEAD"]
      }
    },
    "Compress": true,
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "TrustedSigners": {
      "Enabled": false,
      "Quantity": 0
    },
    "TrustedKeyGroups": {
      "Enabled": false,
      "Quantity": 0
    }
  },
  "PriceClass": "PriceClass_100"
}
EOF

  DISTRIBUTION_RESPONSE=$(aws cloudfront create-distribution \
    --distribution-config file:///tmp/cloudfront-config.json \
    --output json)
  
  DISTRIBUTION_ID=$(echo "$DISTRIBUTION_RESPONSE" | grep -o '"Id": "[^"]*"' | head -1 | cut -d'"' -f4)
  CLOUDFRONT_DOMAIN=$(echo "$DISTRIBUTION_RESPONSE" | grep -o '"DomainName": "[^"]*"' | head -1 | cut -d'"' -f4)
  
  echo "   ✅ CloudFront distribution created!"
  echo "   📍 Distribution ID: ${DISTRIBUTION_ID}"
  echo "   🌐 Domain: ${CLOUDFRONT_DOMAIN}"
else
  CLOUDFRONT_DOMAIN=$(aws cloudfront get-distribution \
    --id "${DISTRIBUTION_ID}" \
    --query "Distribution.DomainName" \
    --output text)
  
  echo "   ✅ CloudFront distribution already exists"
  echo "   📍 Distribution ID: ${DISTRIBUTION_ID}"
  echo "   🌐 Domain: ${CLOUDFRONT_DOMAIN}"
fi

# Step 6: Update S3 bucket policy for CloudFront
echo "🔐 Step 6: Updating S3 bucket policy..."
cat > /tmp/bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFrontRead",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DISTRIBUTION_ID}"
        }
      }
    }
  ]
}
EOF

aws s3api put-bucket-policy \
  --bucket "${BUCKET_NAME}" \
  --policy file:///tmp/bucket-policy.json
echo "   ✅ Bucket policy updated"

# Clean up temp files
rm -f /tmp/cloudfront-config.json /tmp/bucket-policy.json

# Summary
echo ""
echo "🎉 AWS infrastructure setup complete!"
echo ""
echo "📋 Configuration Summary:"
echo "   S3 Bucket:       ${BUCKET_NAME}"
echo "   Region:          ${REGION}"
echo "   CloudFront ID:   ${DISTRIBUTION_ID}"
echo "   CloudFront URL:  https://${CLOUDFRONT_DOMAIN}"
echo ""
echo "⏳ CloudFront distribution is deploying (takes 10-15 minutes)"
echo "   Check status: aws cloudfront get-distribution --id ${DISTRIBUTION_ID} --query 'Distribution.Status'"
echo ""
echo "📝 Next Steps:"
echo "   1. Wait for CloudFront to deploy (Status: Deployed)"
echo "   2. Build installers:"
echo "      bash scripts/build-desktop-windows.sh"
echo "      bash scripts/build-desktop-mac.sh"
echo "   3. Upload to S3:"
echo "      bash scripts/upload-to-aws.sh"
echo "   4. Update download page URLs:"
echo "      sed -i.bak 's|https://d1234567890.cloudfront.net|https://${CLOUDFRONT_DOMAIN}|g' public/LEMarketing-downloads.html"
echo ""
echo "📥 Download URLs will be:"
echo "   https://${CLOUDFRONT_DOMAIN}/downloads/Light-Engine-Setup-1.0.0.exe"
echo "   https://${CLOUDFRONT_DOMAIN}/downloads/Light-Engine-1.0.0.dmg"
echo "   https://${CLOUDFRONT_DOMAIN}/downloads/Light-Engine-1.0.0.ipa"
