#!/bin/bash
##############################################################################
# AWS WAF Setup Script
#
# This script creates a Web ACL with security rules and associates it with
# the Elastic Beanstalk load balancer.
#
# Usage:
#   chmod +x scripts/setup-waf.sh
#   ./scripts/setup-waf.sh
#
# Requirements:
# - AWS CLI installed and configured
# - Permissions for WAFv2 and ELBv2
##############################################################################

set -e  # Exit on error

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
REGION="us-east-1"
WEB_ACL_NAME="foxtrot-web-acl"
METRIC_NAME="foxtrot-waf"
RATE_LIMIT=2000  # requests per 5 minutes per IP

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  AWS WAF Setup for Light Engine Foxtrot${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found${NC}"
    exit 1
fi
echo -e "${GREEN}✅ AWS CLI found${NC}"

# Find Load Balancer ARN
echo ""
echo -e "${YELLOW}🔍 Finding Elastic Beanstalk load balancer...${NC}"
LB_ARN=$(aws elbv2 describe-load-balancers \
    --region "$REGION" \
    --query "LoadBalancers[?contains(LoadBalancerName, 'awseb')].LoadBalancerArn" \
    --output text | head -n 1)

if [ -z "$LB_ARN" ]; then
    echo -e "${RED}❌ Load balancer not found${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Found load balancer: $LB_ARN${NC}"

# Create WAF rules JSON
echo ""
echo -e "${YELLOW}📝 Creating WAF rules configuration...${NC}"

cat > /tmp/waf-rules.json << EOF
[
  {
    "Name": "RateLimitRule",
    "Priority": 1,
    "Statement": {
      "RateBasedStatement": {
        "Limit": $RATE_LIMIT,
        "AggregateKeyType": "IP"
      }
    },
    "Action": {
      "Block": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "RateLimitRule"
    }
  },
  {
    "Name": "AWSManagedRulesCommonRuleSet",
    "Priority": 2,
    "Statement": {
      "ManagedRuleGroupStatement": {
        "VendorName": "AWS",
        "Name": "AWSManagedRulesCommonRuleSet"
      }
    },
    "OverrideAction": {
      "None": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "AWSManagedRulesCommonRuleSet"
    }
  },
  {
    "Name": "AWSManagedRulesKnownBadInputsRuleSet",
    "Priority": 3,
    "Statement": {
      "ManagedRuleGroupStatement": {
        "VendorName": "AWS",
        "Name": "AWSManagedRulesKnownBadInputsRuleSet"
      }
    },
    "OverrideAction": {
      "None": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "AWSManagedRulesKnownBadInputsRuleSet"
    }
  },
  {
    "Name": "AWSManagedRulesSQLiRuleSet",
    "Priority": 4,
    "Statement": {
      "ManagedRuleGroupStatement": {
        "VendorName": "AWS",
        "Name": "AWSManagedRulesSQLiRuleSet"
      }
    },
    "OverrideAction": {
      "None": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "AWSManagedRulesSQLiRuleSet"
    }
  },
  {
    "Name": "AWSManagedRulesLinuxRuleSet",
    "Priority": 5,
    "Statement": {
      "ManagedRuleGroupStatement": {
        "VendorName": "AWS",
        "Name": "AWSManagedRulesLinuxRuleSet"
      }
    },
    "OverrideAction": {
      "None": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "AWSManagedRulesLinuxRuleSet"
    }
  }
]
EOF

echo -e "${GREEN}✅ WAF rules configuration created${NC}"

# Check if Web ACL already exists
echo ""
echo -e "${YELLOW}🔍 Checking for existing Web ACL...${NC}"
EXISTING_WEB_ACL=$(aws wafv2 list-web-acls \
    --scope REGIONAL \
    --region "$REGION" \
    --query "WebACLs[?Name=='$WEB_ACL_NAME'].ARN" \
    --output text)

if [ -n "$EXISTING_WEB_ACL" ]; then
    echo -e "${YELLOW}⚠️  Web ACL already exists: $EXISTING_WEB_ACL${NC}"
    read -p "Delete and recreate? (y/n): " recreate
    if [[ "$recreate" =~ ^[Yy]$ ]]; then
        # Get Web ACL details for deletion
        WEB_ACL_ID=$(aws wafv2 list-web-acls \
            --scope REGIONAL \
            --region "$REGION" \
            --query "WebACLs[?Name=='$WEB_ACL_NAME'].Id" \
            --output text)
        
        LOCK_TOKEN=$(aws wafv2 get-web-acl \
            --scope REGIONAL \
            --region "$REGION" \
            --id "$WEB_ACL_ID" \
            --name "$WEB_ACL_NAME" \
            --query "LockToken" \
            --output text)
        
        # Disassociate from load balancer first
        echo -e "${YELLOW}Disassociating from load balancer...${NC}"
        aws wafv2 disassociate-web-acl \
            --resource-arn "$LB_ARN" \
            --region "$REGION" 2>/dev/null || true
        
        echo -e "${YELLOW}Deleting existing Web ACL...${NC}"
        aws wafv2 delete-web-acl \
            --scope REGIONAL \
            --region "$REGION" \
            --id "$WEB_ACL_ID" \
            --name "$WEB_ACL_NAME" \
            --lock-token "$LOCK_TOKEN"
        
        sleep 5  # Wait for deletion
        echo -e "${GREEN}✅ Existing Web ACL deleted${NC}"
    else
        echo -e "${YELLOW}Using existing Web ACL${NC}"
        WEB_ACL_ARN="$EXISTING_WEB_ACL"
        # Skip creation
        SKIP_CREATION=true
    fi
fi

# Create Web ACL
if [ "$SKIP_CREATION" != "true" ]; then
    echo ""
    echo -e "${YELLOW}🔧 Creating Web ACL...${NC}"
    WEB_ACL_ARN=$(aws wafv2 create-web-acl \
        --name "$WEB_ACL_NAME" \
        --scope REGIONAL \
        --region "$REGION" \
        --default-action Allow={} \
        --rules file:///tmp/waf-rules.json \
        --visibility-config \
            SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName="$METRIC_NAME" \
        --query 'Summary.ARN' \
        --output text)

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Web ACL created: $WEB_ACL_ARN${NC}"
    else
        echo -e "${RED}❌ Failed to create Web ACL${NC}"
        exit 1
    fi
fi

# Associate with Load Balancer
echo ""
echo -e "${YELLOW}🔗 Associating Web ACL with load balancer...${NC}"
aws wafv2 associate-web-acl \
    --web-acl-arn "$WEB_ACL_ARN" \
    --resource-arn "$LB_ARN" \
    --region "$REGION"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Web ACL associated with load balancer${NC}"
else
    echo -e "${RED}❌ Failed to associate Web ACL${NC}"
    exit 1
fi

# Cleanup
rm /tmp/waf-rules.json

# Summary
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  WAF Setup Complete${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Web ACL ARN: $WEB_ACL_ARN"
echo "Load Balancer ARN: $LB_ARN"
echo ""
echo "Configured Rules:"
echo "  1. Rate Limiting: $RATE_LIMIT requests per 5 minutes"
echo "  2. AWS Common Rule Set (OWASP Top 10)"
echo "  3. Known Bad Inputs"
echo "  4. SQL Injection Protection"
echo "  5. Linux OS Protection"
echo ""
echo "View WAF metrics in CloudWatch:"
echo "  https://console.aws.amazon.com/cloudwatch/home?region=$REGION#metricsV2:graph=~()"
echo ""
echo "Test WAF protection:"
echo "  # SQL injection test (should be blocked)"
echo "  curl \"https://YOUR_DOMAIN/api/test?id=1' OR '1'='1\""
echo ""
