#!/bin/bash

################################################################################
# Light Engine - AWS Deployment Script
# 
# Automates deployment of Light Engine to AWS EC2 + RDS + S3
# 
# Usage:
#   ./scripts/deploy-to-aws.sh [--profile PROFILE] [--region REGION]
#
# Requirements:
#   - AWS CLI configured
#   - IAM user with AdministratorAccess
#   - SSH key pair
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
AWS_PROFILE="${AWS_PROFILE:-light-engine}"
AWS_REGION="${AWS_REGION:-us-east-1}"
INSTANCE_TYPE="t3.medium"
RDS_INSTANCE_CLASS="db.t3.micro"
BUCKET_PREFIX="light-engine-prod"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)
      AWS_PROFILE="$2"
      shift 2
      ;;
    --region)
      AWS_REGION="$2"
      shift 2
      ;;
    --instance-type)
      INSTANCE_TYPE="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [--profile PROFILE] [--region REGION] [--instance-type TYPE]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Export for AWS CLI
export AWS_PROFILE
export AWS_REGION

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Light Engine AWS Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Profile: $AWS_PROFILE"
echo "Region: $AWS_REGION"
echo "Instance Type: $INSTANCE_TYPE"
echo "RDS Class: $RDS_INSTANCE_CLASS"
echo ""

# Verify AWS credentials
echo -e "${YELLOW}Verifying AWS credentials...${NC}"
if ! aws sts get-caller-identity > /dev/null 2>&1; then
  echo -e "${RED}Error: AWS credentials not configured${NC}"
  echo "Run: aws configure --profile $AWS_PROFILE"
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✅ AWS Account: $ACCOUNT_ID${NC}"
echo ""

################################################################################
# Phase 1: S3 Buckets
################################################################################
echo -e "${YELLOW}Phase 1: Creating S3 buckets...${NC}"

for BUCKET in data backups static; do
  BUCKET_NAME="${BUCKET_PREFIX}-${BUCKET}"
  
  if aws s3 ls "s3://$BUCKET_NAME" 2>/dev/null; then
    echo "  ⏭️  Bucket already exists: $BUCKET_NAME"
  else
    aws s3 mb "s3://$BUCKET_NAME" --region "$AWS_REGION"
    echo -e "${GREEN}  ✅ Created bucket: $BUCKET_NAME${NC}"
    
    # Enable versioning on data bucket
    if [ "$BUCKET" == "data" ]; then
      aws s3api put-bucket-versioning \
        --bucket "$BUCKET_NAME" \
        --versioning-configuration Status=Enabled
      echo "  ✅ Enabled versioning"
    fi
    
    # Enable encryption
    aws s3api put-bucket-encryption \
      --bucket "$BUCKET_NAME" \
      --server-side-encryption-configuration '{
        "Rules": [{
          "ApplyServerSideEncryptionByDefault": {
            "SSEAlgorithm": "AES256"
          }
        }]
      }'
    echo "  ✅ Enabled encryption"
  fi
done

echo ""

################################################################################
# Phase 2: CloudWatch Log Groups
################################################################################
echo -e "${YELLOW}Phase 2: Creating CloudWatch log groups...${NC}"

for LOG_GROUP in /light-engine/nodejs /light-engine/python /light-engine/nginx; do
  if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --query 'logGroups[0]' --output text > /dev/null 2>&1; then
    echo "  ⏭️  Log group already exists: $LOG_GROUP"
  else
    aws logs create-log-group --log-group-name "$LOG_GROUP"
    aws logs put-retention-policy \
      --log-group-name "$LOG_GROUP" \
      --retention-in-days 30
    echo -e "${GREEN}  ✅ Created log group: $LOG_GROUP${NC}"
  fi
done

echo ""

################################################################################
# Phase 3: Security Groups
################################################################################
echo -e "${YELLOW}Phase 3: Creating security groups...${NC}"

# EC2 Security Group
if aws ec2 describe-security-groups --group-names light-engine-ec2-sg 2>/dev/null; then
  echo "  ⏭️  EC2 security group already exists"
  EC2_SG_ID=$(aws ec2 describe-security-groups \
    --group-names light-engine-ec2-sg \
    --query 'SecurityGroups[0].GroupId' \
    --output text)
else
  aws ec2 create-security-group \
    --group-name light-engine-ec2-sg \
    --description "Security group for Light Engine EC2"
  
  EC2_SG_ID=$(aws ec2 describe-security-groups \
    --group-names light-engine-ec2-sg \
    --query 'SecurityGroups[0].GroupId' \
    --output text)
  
  # Add rules
  aws ec2 authorize-security-group-ingress --group-id $EC2_SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0
  aws ec2 authorize-security-group-ingress --group-id $EC2_SG_ID --protocol tcp --port 443 --cidr 0.0.0.0/0
  aws ec2 authorize-security-group-ingress --group-id $EC2_SG_ID --protocol tcp --port 22 --cidr 0.0.0.0/0
  aws ec2 authorize-security-group-ingress --group-id $EC2_SG_ID --protocol tcp --port 8091 --cidr 0.0.0.0/0
  aws ec2 authorize-security-group-ingress --group-id $EC2_SG_ID --protocol tcp --port 8000 --cidr 0.0.0.0/0
  
  echo -e "${GREEN}  ✅ Created EC2 security group: $EC2_SG_ID${NC}"
fi

# RDS Security Group
if aws ec2 describe-security-groups --group-names light-engine-rds-sg 2>/dev/null; then
  echo "  ⏭️  RDS security group already exists"
  RDS_SG_ID=$(aws ec2 describe-security-groups \
    --group-names light-engine-rds-sg \
    --query 'SecurityGroups[0].GroupId' \
    --output text)
else
  aws ec2 create-security-group \
    --group-name light-engine-rds-sg \
    --description "Security group for Light Engine RDS"
  
  RDS_SG_ID=$(aws ec2 describe-security-groups \
    --group-names light-engine-rds-sg \
    --query 'SecurityGroups[0].GroupId' \
    --output text)
  
  # Allow PostgreSQL from EC2 security group
  aws ec2 authorize-security-group-ingress \
    --group-id $RDS_SG_ID \
    --protocol tcp \
    --port 5432 \
    --source-group $EC2_SG_ID
  
  echo -e "${GREEN}  ✅ Created RDS security group: $RDS_SG_ID${NC}"
fi

echo ""

################################################################################
# Phase 4: SSH Key Pair
################################################################################
echo -e "${YELLOW}Phase 4: Creating SSH key pair...${NC}"

KEY_PATH="$HOME/.ssh/light-engine-key.pem"

if [ -f "$KEY_PATH" ]; then
  echo "  ⏭️  SSH key already exists: $KEY_PATH"
else
  aws ec2 create-key-pair \
    --key-name light-engine-key \
    --query 'KeyMaterial' \
    --output text > "$KEY_PATH"
  
  chmod 400 "$KEY_PATH"
  echo -e "${GREEN}  ✅ Created SSH key: $KEY_PATH${NC}"
fi

echo ""

################################################################################
# Phase 5: RDS Database
################################################################################
echo -e "${YELLOW}Phase 5: Creating RDS database...${NC}"

# Generate random password
DB_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-20)

if aws rds describe-db-instances --db-instance-identifier light-engine-db 2>/dev/null; then
  echo "  ⏭️  RDS instance already exists"
  RDS_ENDPOINT=$(aws rds describe-db-instances \
    --db-instance-identifier light-engine-db \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text)
else
  aws rds create-db-instance \
    --db-instance-identifier light-engine-db \
    --db-instance-class $RDS_INSTANCE_CLASS \
    --engine postgres \
    --engine-version 15.15 \
    --master-username lightengine \
    --master-user-password "$DB_PASSWORD" \
    --allocated-storage 20 \
    --storage-type gp3 \
    --vpc-security-group-ids $RDS_SG_ID \
    --backup-retention-period 7 \
    --publicly-accessible \
    --enable-cloudwatch-logs-exports '["postgresql"]' > /dev/null
  
  echo "  ⏳ Waiting for RDS instance to be available (5-10 minutes)..."
  aws rds wait db-instance-available --db-instance-identifier light-engine-db
  
  RDS_ENDPOINT=$(aws rds describe-db-instances \
    --db-instance-identifier light-engine-db \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text)
  
  echo -e "${GREEN}  ✅ Created RDS instance: $RDS_ENDPOINT${NC}"
  
  # Save credentials
  cat > .env.rds << EOF
DATABASE_URL=postgresql://lightengine:$DB_PASSWORD@$RDS_ENDPOINT:5432/lightengine
RDS_ENDPOINT=$RDS_ENDPOINT
RDS_USERNAME=lightengine
RDS_PASSWORD=$DB_PASSWORD
EOF
  echo "  ✅ Saved credentials to .env.rds"
fi

echo ""

################################################################################
# Phase 6: EC2 Instance
################################################################################
echo -e "${YELLOW}Phase 6: Launching EC2 instance...${NC}"

# Get latest Ubuntu 22.04 AMI
AMI_ID=$(aws ec2 describe-images \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text)

echo "  Using AMI: $AMI_ID"

# Check if instance already exists
EXISTING_INSTANCE=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=light-engine-prod" "Name=instance-state-name,Values=running,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text 2>/dev/null || echo "None")

if [ "$EXISTING_INSTANCE" != "None" ]; then
  echo "  ⏭️  EC2 instance already exists: $EXISTING_INSTANCE"
  INSTANCE_ID=$EXISTING_INSTANCE
  
  # Start if stopped
  STATE=$(aws ec2 describe-instances \
    --instance-ids $INSTANCE_ID \
    --query 'Reservations[0].Instances[0].State.Name' \
    --output text)
  
  if [ "$STATE" == "stopped" ]; then
    aws ec2 start-instances --instance-ids $INSTANCE_ID
    echo "  ⏳ Starting instance..."
    aws ec2 wait instance-running --instance-ids $INSTANCE_ID
  fi
else
  # Create user data script
  cat > /tmp/user-data.sh << 'USERDATA'
#!/bin/bash
set -e

apt-get update
apt-get upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install Python 3.11
apt-get install -y python3.11 python3.11-venv python3-pip

# Install PostgreSQL client
apt-get install -y postgresql-client

# Install nginx
apt-get install -y nginx

# Install CloudWatch agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
dpkg -i -E ./amazon-cloudwatch-agent.deb

# Create app directory
mkdir -p /opt/light-engine
chown ubuntu:ubuntu /opt/light-engine

# Install PM2
npm install -g pm2

echo "✅ EC2 initialization complete" > /tmp/init-complete
USERDATA

  # Launch instance
  INSTANCE_ID=$(aws ec2 run-instances \
    --image-id $AMI_ID \
    --instance-type $INSTANCE_TYPE \
    --key-name light-engine-key \
    --security-group-ids $EC2_SG_ID \
    --user-data file:///tmp/user-data.sh \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=light-engine-prod}]' \
    --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3"}}]' \
    --query 'Instances[0].InstanceId' \
    --output text)
  
  echo -e "${GREEN}  ✅ Launched instance: $INSTANCE_ID${NC}"
  
  echo "  ⏳ Waiting for instance to be running..."
  aws ec2 wait instance-running --instance-ids $INSTANCE_ID
fi

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo -e "${GREEN}  ✅ Public IP: $PUBLIC_IP${NC}"

echo ""

################################################################################
# Phase 7: Save Configuration
################################################################################
echo -e "${YELLOW}Phase 7: Saving configuration...${NC}"

cat > .env.aws.deployment << EOF
# AWS Deployment Configuration
# Generated: $(date)

AWS_PROFILE=$AWS_PROFILE
AWS_REGION=$AWS_REGION
AWS_ACCOUNT_ID=$ACCOUNT_ID

# S3 Buckets
S3_DATA_BUCKET=${BUCKET_PREFIX}-data
S3_BACKUPS_BUCKET=${BUCKET_PREFIX}-backups
S3_STATIC_BUCKET=${BUCKET_PREFIX}-static

# EC2
EC2_INSTANCE_ID=$INSTANCE_ID
EC2_PUBLIC_IP=$PUBLIC_IP
EC2_SG_ID=$EC2_SG_ID

# RDS
RDS_ENDPOINT=$RDS_ENDPOINT
RDS_SG_ID=$RDS_SG_ID

# SSH
SSH_KEY_PATH=$KEY_PATH
EOF

echo -e "${GREEN}  ✅ Saved to .env.aws.deployment${NC}"

echo ""

################################################################################
# Summary
################################################################################
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "📦 Resources Created:"
echo "  - S3 Buckets: ${BUCKET_PREFIX}-{data,backups,static}"
echo "  - CloudWatch Log Groups: /light-engine/{nodejs,python,nginx}"
echo "  - EC2 Instance: $INSTANCE_ID ($INSTANCE_TYPE)"
echo "  - RDS Database: light-engine-db ($RDS_INSTANCE_CLASS)"
echo "  - Security Groups: EC2 ($EC2_SG_ID), RDS ($RDS_SG_ID)"
echo ""
echo "🌐 Access Information:"
echo "  - Public IP: $PUBLIC_IP"
echo "  - SSH: ssh -i $KEY_PATH ubuntu@$PUBLIC_IP"
echo "  - Dashboard: http://$PUBLIC_IP/"
echo "  - API Docs: http://$PUBLIC_IP/docs"
echo ""
echo "📝 Next Steps:"
echo "  1. Deploy application code:"
echo "     ./scripts/deploy-code.sh --ip $PUBLIC_IP"
echo ""
echo "  2. Configure environment variables on EC2"
echo ""
echo "  3. Start services with PM2"
echo ""
echo "  4. Configure nginx reverse proxy"
echo ""
echo "  5. Set up SSL with certbot (optional)"
echo ""
echo "📄 Configuration saved to:"
echo "  - .env.aws.deployment (deployment info)"
echo "  - .env.rds (database credentials)"
echo ""
echo -e "${YELLOW}⚠️  Keep .env.rds secure - contains database password!${NC}"
echo ""
