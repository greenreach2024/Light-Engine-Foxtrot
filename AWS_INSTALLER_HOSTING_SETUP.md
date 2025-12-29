# AWS Installer Hosting Setup Guide

**Purpose:** Host Light Engine installers (.exe, .dmg, .ipa) on AWS S3 + CloudFront for global distribution

**Date:** December 29, 2025  
**Status:** Configuration Guide

---

## Overview

All Light Engine installers are served from AWS infrastructure:
- **S3 Bucket:** Stores binary files (.exe, .dmg, .ipa) and checksums
- **CloudFront:** CDN for fast global downloads with HTTPS
- **IAM Policies:** Secure access control
- **CloudWatch:** Download metrics and monitoring

**Architecture:**
```
Build Scripts → S3 Bucket → CloudFront CDN → Customer Downloads
                   ↓
              CloudWatch Logs
```

---

## Step 1: Create S3 Bucket

```bash
# Set variables
BUCKET_NAME="light-engine-installers"
REGION="us-east-1"

# Create bucket
aws s3 mb s3://${BUCKET_NAME} --region ${REGION}

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket ${BUCKET_NAME} \
  --versioning-configuration Status=Enabled

# Configure lifecycle policy (optional: delete old versions after 90 days)
cat > lifecycle-policy.json <<EOF
{
  "Rules": [
    {
      "Id": "DeleteOldVersions",
      "Status": "Enabled",
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 90
      }
    }
  ]
}
EOF

aws s3api put-bucket-lifecycle-configuration \
  --bucket ${BUCKET_NAME} \
  --lifecycle-configuration file://lifecycle-policy.json
```

---

## Step 2: Configure S3 Bucket Policy

```bash
cat > bucket-policy.json <<EOF
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
          "AWS:SourceArn": "arn:aws:cloudfront::ACCOUNT_ID:distribution/DISTRIBUTION_ID"
        }
      }
    }
  ]
}
EOF

# Apply policy (update ACCOUNT_ID and DISTRIBUTION_ID after creating CloudFront)
aws s3api put-bucket-policy \
  --bucket ${BUCKET_NAME} \
  --policy file://bucket-policy.json
```

---

## Step 3: Upload Installers to S3

```bash
# Navigate to project root
cd /Users/petergilbert/Light-Engine-Foxtrot

# Build installers first (if not already built)
bash scripts/build-desktop-windows.sh
bash scripts/build-desktop-mac.sh

# Upload Windows installer
aws s3 cp desktop-app/dist/Light-Engine-Setup-1.0.0.exe \
  s3://${BUCKET_NAME}/downloads/ \
  --content-type "application/x-msdownload" \
  --metadata "version=1.0.0,platform=windows,build-date=$(date -u +%Y-%m-%d)"

# Upload macOS installer
aws s3 cp desktop-app/dist/Light-Engine-1.0.0.dmg \
  s3://${BUCKET_NAME}/downloads/ \
  --content-type "application/x-apple-diskimage" \
  --metadata "version=1.0.0,platform=macos,build-date=$(date -u +%Y-%m-%d)"

# Upload iOS app (after Expo build)
aws s3 cp mobile-app/Light-Engine-1.0.0.ipa \
  s3://${BUCKET_NAME}/downloads/ \
  --content-type "application/octet-stream" \
  --metadata "version=1.0.0,platform=ios,build-date=$(date -u +%Y-%m-%d)"

# Upload checksums
aws s3 cp desktop-app/dist/Light-Engine-Setup-1.0.0.exe.sha256 \
  s3://${BUCKET_NAME}/downloads/ \
  --content-type "text/plain"

aws s3 cp desktop-app/dist/Light-Engine-1.0.0.dmg.sha256 \
  s3://${BUCKET_NAME}/downloads/ \
  --content-type "text/plain"
```

---

## Step 4: Create CloudFront Distribution

```bash
# Create Origin Access Control (OAC) for S3
aws cloudfront create-origin-access-control \
  --origin-access-control-config \
    Name=light-engine-s3-oac,\
    Description="OAC for Light Engine installers",\
    SigningProtocol=sigv4,\
    SigningBehavior=always,\
    OriginAccessControlOriginType=s3

# Create CloudFront distribution
cat > cloudfront-config.json <<EOF
{
  "CallerReference": "light-engine-$(date +%s)",
  "Comment": "Light Engine Installers CDN",
  "Enabled": true,
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-light-engine-installers",
        "DomainName": "${BUCKET_NAME}.s3.${REGION}.amazonaws.com",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        },
        "OriginAccessControlId": "OAC_ID_FROM_PREVIOUS_STEP"
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-light-engine-installers",
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
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6"
  },
  "PriceClass": "PriceClass_100",
  "ViewerCertificate": {
    "CloudFrontDefaultCertificate": true,
    "MinimumProtocolVersion": "TLSv1.2_2021"
  }
}
EOF

# Create distribution
aws cloudfront create-distribution \
  --distribution-config file://cloudfront-config.json

# Get distribution ID and domain name
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='Light Engine Installers CDN'].Id" \
  --output text)

CLOUDFRONT_DOMAIN=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='Light Engine Installers CDN'].DomainName" \
  --output text)

echo "CloudFront Distribution ID: ${DISTRIBUTION_ID}"
echo "CloudFront Domain: ${CLOUDFRONT_DOMAIN}"
echo ""
echo "Update LEMarketing-downloads.html with:"
echo "  https://${CLOUDFRONT_DOMAIN}/downloads/Light-Engine-Setup-1.0.0.exe"
echo "  https://${CLOUDFRONT_DOMAIN}/downloads/Light-Engine-1.0.0.dmg"
echo "  https://${CLOUDFRONT_DOMAIN}/downloads/Light-Engine-1.0.0.ipa"
```

---

## Step 5: Configure Custom Domain (Optional)

If you want to use `downloads.lightengine.app` instead of CloudFront default domain:

```bash
# 1. Request SSL certificate in us-east-1 (required for CloudFront)
aws acm request-certificate \
  --domain-name downloads.lightengine.app \
  --validation-method DNS \
  --region us-east-1

# 2. Validate certificate via DNS (add CNAME records shown in ACM console)

# 3. Update CloudFront distribution with custom domain
aws cloudfront update-distribution \
  --id ${DISTRIBUTION_ID} \
  --if-match ETAG_FROM_GET_DISTRIBUTION \
  --distribution-config file://updated-cloudfront-config.json

# 4. Create Route 53 alias record
aws route53 change-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --change-batch file://route53-change.json
```

---

## Step 6: Update Download Page URLs

Replace placeholder CloudFront URLs in `public/LEMarketing-downloads.html`:

```bash
# Get your actual CloudFront domain
CLOUDFRONT_DOMAIN=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='Light Engine Installers CDN'].DomainName" \
  --output text)

# Update download page (manual edit or sed)
sed -i.bak "s|https://d1234567890.cloudfront.net|https://${CLOUDFRONT_DOMAIN}|g" \
  public/LEMarketing-downloads.html

echo "✅ Updated download URLs to: https://${CLOUDFRONT_DOMAIN}"
```

---

## Step 7: Enable CloudWatch Logging

```bash
# Create S3 bucket for CloudFront logs
aws s3 mb s3://light-engine-cloudfront-logs --region us-east-1

# Enable logging in CloudFront distribution
aws cloudfront update-distribution \
  --id ${DISTRIBUTION_ID} \
  --distribution-config file://cloudfront-config-with-logging.json
```

**CloudFront Logging Config:**
```json
{
  "Logging": {
    "Enabled": true,
    "IncludeCookies": false,
    "Bucket": "light-engine-cloudfront-logs.s3.amazonaws.com",
    "Prefix": "downloads/"
  }
}
```

---

## Step 8: Set Up CloudWatch Metrics

Create custom metrics for download tracking:

```bash
# CloudWatch dashboard for downloads
cat > cloudwatch-dashboard.json <<EOF
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/CloudFront", "Requests", { "stat": "Sum" } ],
          [ ".", "BytesDownloaded", { "stat": "Sum" } ]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "us-east-1",
        "title": "Download Metrics"
      }
    }
  ]
}
EOF

aws cloudwatch put-dashboard \
  --dashboard-name LightEngineDownloads \
  --dashboard-body file://cloudwatch-dashboard.json
```

---

## Step 9: Automated Upload Script

Create script for CI/CD pipeline:

```bash
cat > scripts/upload-to-aws.sh <<'EOF'
#!/bin/bash
# Upload Light Engine installers to AWS S3 + CloudFront

set -e

BUCKET_NAME="light-engine-installers"
VERSION="1.0.0"

echo "🚀 Uploading Light Engine v${VERSION} to AWS..."

# Windows
if [ -f "desktop-app/dist/Light-Engine-Setup-${VERSION}.exe" ]; then
  aws s3 cp "desktop-app/dist/Light-Engine-Setup-${VERSION}.exe" \
    "s3://${BUCKET_NAME}/downloads/" \
    --content-type "application/x-msdownload"
  echo "✅ Windows installer uploaded"
fi

# macOS
if [ -f "desktop-app/dist/Light-Engine-${VERSION}.dmg" ]; then
  aws s3 cp "desktop-app/dist/Light-Engine-${VERSION}.dmg" \
    "s3://${BUCKET_NAME}/downloads/" \
    --content-type "application/x-apple-diskimage"
  echo "✅ macOS installer uploaded"
fi

# iOS
if [ -f "mobile-app/Light-Engine-${VERSION}.ipa" ]; then
  aws s3 cp "mobile-app/Light-Engine-${VERSION}.ipa" \
    "s3://${BUCKET_NAME}/downloads/" \
    --content-type "application/octet-stream"
  echo "✅ iOS app uploaded"
fi

# Invalidate CloudFront cache
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='Light Engine Installers CDN'].Id" \
  --output text)

aws cloudfront create-invalidation \
  --distribution-id ${DISTRIBUTION_ID} \
  --paths "/downloads/*"

echo "✅ CloudFront cache invalidated"
echo "🎉 All installers uploaded successfully!"
EOF

chmod +x scripts/upload-to-aws.sh
```

---

## Step 10: Test Downloads

```bash
# Get CloudFront URL
CLOUDFRONT_DOMAIN=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='Light Engine Installers CDN'].DomainName" \
  --output text)

# Test downloads
echo "Testing downloads..."

curl -I "https://${CLOUDFRONT_DOMAIN}/downloads/Light-Engine-Setup-1.0.0.exe"
curl -I "https://${CLOUDFRONT_DOMAIN}/downloads/Light-Engine-1.0.0.dmg"
curl -I "https://${CLOUDFRONT_DOMAIN}/downloads/Light-Engine-1.0.0.ipa"

# Verify checksums
curl "https://${CLOUDFRONT_DOMAIN}/downloads/Light-Engine-Setup-1.0.0.exe.sha256"
```

---

## Monitoring & Maintenance

**CloudWatch Alarms:**
```bash
# High error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name light-engine-downloads-errors \
  --alarm-description "Alert on high 4xx/5xx errors" \
  --metric-name 5xxErrorRate \
  --namespace AWS/CloudFront \
  --statistic Average \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT_ID:ops-alerts
```

**Cost Monitoring:**
- S3 Storage: ~$0.023/GB/month (negligible for ~500MB total)
- CloudFront: ~$0.085/GB for first 10TB (pay per download)
- Estimated cost: <$10/month for 1000 downloads

**Backup Strategy:**
- S3 versioning enabled (automatic backups)
- Cross-region replication (optional for disaster recovery)
- Monthly snapshots to Glacier for long-term archival

---

## Security Checklist

- ✅ S3 bucket NOT publicly accessible (CloudFront only)
- ✅ HTTPS enforced (TLS 1.2+)
- ✅ Origin Access Control (OAC) configured
- ✅ Bucket versioning enabled
- ✅ CloudWatch logging enabled
- ✅ IAM policies follow least privilege
- ✅ SSL certificate for custom domain
- ✅ SHA256 checksums provided for verification

---

## Summary

**S3 Bucket:** `light-engine-installers`  
**CloudFront Distribution:** Auto-assigned (e.g., `d1234567890.cloudfront.net`)  
**Custom Domain:** `downloads.lightengine.app` (optional)

**Download URLs:**
- Windows: `https://{cloudfront-domain}/downloads/Light-Engine-Setup-1.0.0.exe`
- macOS: `https://{cloudfront-domain}/downloads/Light-Engine-1.0.0.dmg`
- iOS: `https://{cloudfront-domain}/downloads/Light-Engine-1.0.0.ipa`

**Next Steps:**
1. Run CloudFormation/CLI commands above
2. Build installers with build scripts
3. Upload to S3 with `scripts/upload-to-aws.sh`
4. Update download page with actual CloudFront domain
5. Test downloads from marketing page
