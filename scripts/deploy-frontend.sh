#!/bin/bash
# ==========================================
# Light Engine Frontend Deployment Script
# Deploys to AWS S3 + CloudFront
# ==========================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROFILE="${AWS_PROFILE:-light-engine}"
BUCKET="${AWS_S3_ASSETS_BUCKET:-light-engine-assets-production}"
DISTRIBUTION_ID="${AWS_CLOUDFRONT_DISTRIBUTION_ID:-E2N3IO26J80JEK}"
SOURCE_DIR="public"
DRY_RUN=false
DEMO_DEPLOY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --bucket)
      BUCKET="$2"
      shift 2
      ;;
    --distribution)
      DISTRIBUTION_ID="$2"
      shift 2
      ;;
    --source)
      SOURCE_DIR="$2"
      shift 2
      ;;
    --demo)
      DEMO_DEPLOY=true
      SOURCE_DIR="docs"
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --profile PROFILE         AWS CLI profile (default: light-engine)"
      echo "  --bucket BUCKET           S3 bucket name"
      echo "  --distribution ID         CloudFront distribution ID"
      echo "  --source DIR              Source directory to deploy (default: public)"
      echo "  --demo                    Deploy demo bundle (uses docs/ with AWS fetch interceptors)"
      echo "  --dry-run                 Preview changes without uploading"
      echo "  --help                    Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Print configuration
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Light Engine Deployment to AWS       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  Profile:       $PROFILE"
echo "  S3 Bucket:     $BUCKET"
echo "  CloudFront:    $DISTRIBUTION_ID"
echo "  Source:        $SOURCE_DIR"
echo "  Demo Deploy:   $DEMO_DEPLOY"
echo "  Dry Run:       $DRY_RUN"
echo ""

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Install with: brew install awscli${NC}"
    exit 1
fi

# Check if profile exists
if ! aws configure list --profile $PROFILE &> /dev/null; then
    echo -e "${RED}❌ AWS profile '$PROFILE' not found${NC}"
    echo -e "${YELLOW}Configure with: aws configure --profile $PROFILE${NC}"
    exit 1
fi

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo -e "${RED}❌ Source directory '$SOURCE_DIR' not found${NC}"
    exit 1
fi

# Check if bucket exists
echo -e "${BLUE}🔍 Checking S3 bucket...${NC}"
if ! aws s3 ls "s3://$BUCKET" --profile $PROFILE &> /dev/null; then
    echo -e "${RED}❌ Bucket '$BUCKET' not found or not accessible${NC}"
    echo -e "${YELLOW}Create with: aws s3 mb s3://$BUCKET --profile $PROFILE${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Bucket accessible${NC}"

# Dry run check
if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}🔍 DRY RUN MODE - No changes will be made${NC}"
    DRY_RUN_FLAG="--dryrun"
else
    DRY_RUN_FLAG=""
fi

# Upload static assets (long cache)
echo ""
echo -e "${BLUE}📦 Uploading static assets (CSS, JS, images)...${NC}"
aws s3 sync $SOURCE_DIR/ s3://$BUCKET/ \
  --profile $PROFILE \
  $DRY_RUN_FLAG \
  --exclude "*.html" \
  --exclude "*.json" \
  --exclude "*.md" \
  --exclude ".DS_Store" \
  --cache-control "public, max-age=31536000, immutable" \
  --metadata-directive REPLACE \
  --delete

# Upload HTML files (short cache)
echo ""
echo -e "${BLUE}📄 Uploading HTML files...${NC}"
aws s3 sync $SOURCE_DIR/ s3://$BUCKET/ \
  --profile $PROFILE \
  $DRY_RUN_FLAG \
  --exclude "*" \
  --include "*.html" \
  --cache-control "public, max-age=3600, must-revalidate" \
  --content-type "text/html; charset=utf-8" \
  --metadata-directive REPLACE

# Upload JSON files (medium cache)
echo ""
echo -e "${BLUE}📋 Uploading JSON files...${NC}"
aws s3 sync $SOURCE_DIR/ s3://$BUCKET/ \
  --profile $PROFILE \
  $DRY_RUN_FLAG \
  --exclude "*" \
  --include "*.json" \
  --cache-control "public, max-age=7200" \
  --content-type "application/json" \
  --metadata-directive REPLACE

# Invalidate CloudFront cache
if [ "$DRY_RUN" = false ] && [ -n "$DISTRIBUTION_ID" ]; then
    echo ""
    echo -e "${BLUE}🔄 Invalidating CloudFront cache...${NC}"
    
    INVALIDATION_ID=$(aws cloudfront create-invalidation \
      --profile $PROFILE \
      --distribution-id $DISTRIBUTION_ID \
      --paths "/*" \
      --query 'Invalidation.Id' \
      --output text)
    
    echo -e "${GREEN}✅ Invalidation created: $INVALIDATION_ID${NC}"
    echo -e "${YELLOW}⏳ Cache invalidation may take 5-10 minutes to complete${NC}"
    
    # Get CloudFront domain
    CLOUDFRONT_DOMAIN=$(aws cloudfront get-distribution \
      --profile $PROFILE \
      --id $DISTRIBUTION_ID \
      --query 'Distribution.DomainName' \
      --output text)
    
    echo ""
    echo -e "${GREEN}🌐 CloudFront URL: https://$CLOUDFRONT_DOMAIN${NC}"
else
    echo ""
    echo -e "${YELLOW}⏭️  Skipping CloudFront invalidation (dry run or no distribution ID)${NC}"
fi

# Summary
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Deployment Complete!               ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Summary:${NC}"
echo "  • Files uploaded to: s3://$BUCKET"
if [ -n "$CLOUDFRONT_DOMAIN" ]; then
    echo "  • CDN URL: https://$CLOUDFRONT_DOMAIN"
fi
echo "  • Billing page: https://$CLOUDFRONT_DOMAIN/billing.html"
echo "  • Admin page: https://$CLOUDFRONT_DOMAIN/admin.html"
echo ""

# Optional: Open in browser
if [ "$DRY_RUN" = false ] && [ -n "$CLOUDFRONT_DOMAIN" ]; then
    read -p "Open in browser? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "https://$CLOUDFRONT_DOMAIN"
    fi
fi
